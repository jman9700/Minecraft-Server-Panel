// ─────────────────────────────────────────────────────────────
// Minecraft Server Panel — server.js
// Main entry point. Run with: node server.js
// ─────────────────────────────────────────────────────────────

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, execSync } = require("child_process");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ── Load / create config ────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, "config.json");
const USERS_PATH = path.join(__dirname, "data", "users.json");

const DEFAULT_CONFIG = {
  port: 3847,
  jwtSecret: uuidv4() + uuidv4(),              // auto-generated on first run
  serverDir: "C:\\\\MinecraftServer",             // user should update this
  startCommand: "start.bat",                    // the CurseForge launch script
  tokenExpiryHours: 8,
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  demoDir: "",               // where demo media lives; blank = public/demo
  loginRateMax: 10,          // max /api/login requests per IP per window
  loginRateWindowMs: 60000
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`[INIT] Created config.json — edit "serverDir" to point at your server folder.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

const config = loadConfig();

// ── Panel version ───────────────────────────────────────────
//
// A fingerprint of the panel's own deployed source, so the test suite
// can tell "this panel is running older code than the repo" apart from
// "this feature is broken". Without it, a stale deploy shows up as a
// pile of confusing assertion diffs.
//
// Derived from the files rather than a hand-bumped constant so it can't
// drift: change either file and the fingerprint changes, no discipline
// required. Line endings are normalised because the repo is checked out
// CRLF on Windows and LF on the CI runner, and we want to compare
// content, not checkout style.
const PANEL_SOURCE_FILES = ["server.js", path.join("public", "index.html")];

function computePanelVersion() {
  const hash = crypto.createHash("sha256");
  for (const rel of PANEL_SOURCE_FILES) {
    hash.update(rel.replace(/\\/g, "/"));
    hash.update(fs.readFileSync(path.join(__dirname, rel), "utf-8").replace(/\r\n/g, "\n"));
  }
  return hash.digest("hex").slice(0, 12);
}

const PANEL_VERSION = computePanelVersion();

// ── Login throttling knobs ──────────────────────────────────
// Each comes from config.json, with a PANEL_LOGIN_* env var override on
// top (handy for CI / test deployments) and a hard default last.
function loginKnob(envName, cfgKey, fallback) {
  const fromEnv = Number(process.env[envName]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  const fromCfg = Number(config[cfgKey]);
  if (Number.isFinite(fromCfg) && fromCfg > 0) return Math.floor(fromCfg);
  return fallback;
}
const LOGIN_MAX_ATTEMPTS    = loginKnob("PANEL_LOGIN_MAX_ATTEMPTS", "maxLoginAttempts", 5);
const LOGIN_LOCKOUT_MINUTES = loginKnob("PANEL_LOGIN_LOCKOUT_MINUTES", "lockoutMinutes", 15);
const LOGIN_RATE_MAX        = loginKnob("PANEL_LOGIN_RATE_MAX", "loginRateMax", 10);
const LOGIN_RATE_WINDOW_MS  = loginKnob("PANEL_LOGIN_RATE_WINDOW_MS", "loginRateWindowMs", 60000);

// ── Ensure data directory ───────────────────────────────────
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

// ── User store helpers ──────────────────────────────────────
const SALT_ROUNDS = 12;

function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) {
    fs.writeFileSync(USERS_PATH, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

// ── Login attempt tracking (in-memory) ──────────────────────
const loginAttempts = {};            // { username: { count, lockedUntil } }

function checkLockout(username) {
  const record = loginAttempts[username];
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    delete loginAttempts[username];  // lockout expired
    return false;
  }
  return false;
}

function recordFailedLogin(username) {
  if (!loginAttempts[username]) loginAttempts[username] = { count: 0 };
  loginAttempts[username].count++;
  if (loginAttempts[username].count >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts[username].lockedUntil = Date.now() + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
  }
}

function clearLoginAttempts(username) {
  delete loginAttempts[username];
}

// ── Audit log ───────────────────────────────────────────────
const AUDIT_PATH = path.join(__dirname, "data", "audit.log");

function audit(username, action, detail = "") {
  const line = `[${new Date().toISOString()}] ${username}: ${action} ${detail}\n`;
  fs.appendFileSync(AUDIT_PATH, line);
  console.log(line.trim());
}

// ── JWT helpers ─────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    { username: user.username, permissions: user.permissions },
    config.jwtSecret,
    { expiresIn: `${config.tokenExpiryHours}h` }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(header.split(" ")[1], config.jwtSecret);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requirePermission(...perms) {
  return (req, res, next) => {
    const userPerms = req.user.permissions || [];
    const has = perms.some(p => userPerms.includes(p));
    if (!has) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

// ── Minecraft process management ────────────────────────────
let mcProcess = null;
let mcStatus = "stopped";      // stopped | starting | running | stopping
let mcOutput = [];              // rolling buffer of last 200 lines
const MAX_OUTPUT = 200;

function pushOutput(line) {
  mcOutput.push(line);
  if (mcOutput.length > MAX_OUTPUT) mcOutput.shift();
}

function startServer() {
  if (mcProcess) throw new Error("Server is already running");

  const serverDir = config.serverDir;
  const startCmd = config.startCommand;

  if (!fs.existsSync(serverDir)) {
    throw new Error(`Server directory not found: ${serverDir}`);
  }

  const cmdPath = path.join(serverDir, startCmd);
  if (!fs.existsSync(cmdPath)) {
    throw new Error(`Start script not found: ${cmdPath}`);
  }

  mcStatus = "starting";
  mcOutput = [];
  pushOutput(`[Panel] Starting server with ${startCmd}...`);

  // On Windows, run the .bat through cmd.exe
  mcProcess = spawn("cmd.exe", ["/c", startCmd], {
    cwd: serverDir,
    windowsHide: true
  });

  mcProcess.stdout.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/).filter(l => l.trim());
    lines.forEach(l => {
      pushOutput(l);
      // Detect when server is ready
      if (l.includes("Done") && l.includes("For help")) {
        mcStatus = "running";
      }
    });
  });

  mcProcess.stderr.on("data", (data) => {
    data.toString().split(/\r?\n/).filter(l => l.trim()).forEach(l => pushOutput(`[ERR] ${l}`));
  });

  mcProcess.on("close", (code) => {
    pushOutput(`[Panel] Server process exited with code ${code}`);
    mcProcess = null;
    mcStatus = "stopped";
  });

  mcProcess.on("error", (err) => {
    pushOutput(`[Panel] Failed to start: ${err.message}`);
    mcProcess = null;
    mcStatus = "stopped";
  });
}

function stopServer() {
  if (!mcProcess) throw new Error("Server is not running");
  mcStatus = "stopping";
  pushOutput("[Panel] Sending 'stop' command...");

  // Try graceful stop first
  try {
    mcProcess.stdin.write("stop\n");
  } catch {
    // If stdin is closed, force kill
    mcProcess.kill("SIGTERM");
  }

  // Force kill after 30 seconds if still alive
  const killTimer = setTimeout(() => {
    if (mcProcess) {
      pushOutput("[Panel] Graceful stop timed out, force killing...");
      mcProcess.kill("SIGKILL");
    }
  }, 30000);

  mcProcess.on("close", () => clearTimeout(killTimer));
}

function sendCommand(cmd) {
  if (!mcProcess) throw new Error("Server is not running");
  mcProcess.stdin.write(cmd + "\n");
  pushOutput(`[CMD] ${cmd}`);
}

// ── Express app ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Rate-limit login endpoint (simple in-memory)
const loginRateMap = {};
app.use("/api/login", (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  if (!loginRateMap[ip]) loginRateMap[ip] = [];
  loginRateMap[ip] = loginRateMap[ip].filter(t => now - t < LOGIN_RATE_WINDOW_MS);
  if (loginRateMap[ip].length >= LOGIN_RATE_MAX) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }
  loginRateMap[ip].push(now);
  next();
});

// ── Auth routes ─────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  if (checkLockout(username)) {
    return res.status(423).json({ error: `Account locked. Try again in ${LOGIN_LOCKOUT_MINUTES} minutes.` });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    recordFailedLogin(username);
    return res.status(401).json({ error: "Incorrect Username and/or Password" });
  }

  if (user.disabled) {
    return res.status(403).json({ error: "Account is disabled" });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    recordFailedLogin(username);
    audit(username, "LOGIN_FAILED");
    return res.status(401).json({ error: "Incorrect Username and/or Password" });
  }

  clearLoginAttempts(username);
  const token = generateToken(user);
  audit(username, "LOGIN_OK");
  res.json({ token, username: user.username, permissions: user.permissions });
});

// ── Server control routes ───────────────────────────────────
app.get("/api/status", authMiddleware, (req, res) => {
  res.json({ status: mcStatus, output: mcOutput });
});

// Behind auth on purpose: the repo is public, so an unauthenticated
// fingerprint would let anyone map the deployment to an exact commit and
// look up which fixes it's missing.
app.get("/api/version", authMiddleware, (req, res) => {
  res.json({ version: PANEL_VERSION, files: PANEL_SOURCE_FILES });
});

app.post("/api/server/start", authMiddleware, requirePermission("start"), (req, res) => {
  try {
    startServer();
    audit(req.user.username, "SERVER_START");
    res.json({ ok: true, status: mcStatus });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/server/stop", authMiddleware, requirePermission("kill"), (req, res) => {
  try {
    stopServer();
    audit(req.user.username, "SERVER_STOP");
    res.json({ ok: true, status: mcStatus });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/server/restart", authMiddleware, requirePermission("restart"), (req, res) => {
  try {
    if (mcProcess) {
      stopServer();
      // Wait for process to exit then restart
      const check = setInterval(() => {
        if (!mcProcess) {
          clearInterval(check);
          setTimeout(() => {
            try {
              startServer();
              audit(req.user.username, "SERVER_RESTART");
            } catch (e) {
              pushOutput(`[Panel] Restart failed: ${e.message}`);
            }
          }, 2000);
        }
      }, 1000);
    } else {
      startServer();
      audit(req.user.username, "SERVER_START_VIA_RESTART");
    }
    res.json({ ok: true, status: "restarting" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/server/kill", authMiddleware, requirePermission("kill"), (req, res) => {
  if (!mcProcess) return res.status(400).json({ error: "Server is not running" });
  mcProcess.kill("SIGKILL");
  pushOutput("[Panel] Server force-killed by " + req.user.username);
  audit(req.user.username, "SERVER_KILL");
  mcProcess = null;
  mcStatus = "stopped";
  res.json({ ok: true });
});

// ── Console command guard ───────────────────────────────────
//
// Everything this panel is allowed to touch lives under one directory:
// `config.serverDir` (set in config.json, which is gitignored because it
// also holds the JWT secret). The file browser is already fenced into it
// by safePath() below.
//
// The console is NOT fenced. Commands go straight to the Minecraft
// server process's stdin, and plenty of them take paths -- so a relative
// path with ".." in it can reach files outside serverDir entirely.
// Until the console gets a proper path-aware allowlist, we reject ".."
// outright.
//
// This is deliberately blunt: it also rejects harmless chat like
// `say hmm...`. If a legitimate command ever needs "..", add a carve-out
// here rather than loosening the rule.
const CONSOLE_TRAVERSAL = "..";
const CONSOLE_TRAVERSAL_ERROR =
  'Command rejected: ".." is not allowed in console commands (paths must stay inside the server directory)';

function hasTraversal(cmd) {
  return cmd.includes(CONSOLE_TRAVERSAL);
}

app.post("/api/server/command", authMiddleware, requirePermission("console"), (req, res) => {
  const cmd = req.body.command;

  // An absent command is a client bug, not a security event -- don't audit it.
  if (typeof cmd !== "string" || !cmd.trim()) {
    return res.status(400).json({ error: "Command required" });
  }

  // A blocked traversal attempt IS worth keeping in the audit log.
  if (hasTraversal(cmd)) {
    audit(req.user.username, "CONSOLE_CMD_BLOCKED", cmd);
    return res.status(400).json({ error: CONSOLE_TRAVERSAL_ERROR });
  }

  try {
    sendCommand(cmd);
    audit(req.user.username, "CONSOLE_CMD", cmd);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── World backups ───────────────────────────────────────────
//
// Copies <serverDir>/world into <panelDir>/backups/. Three rules, all of
// them load-bearing:
//
//   1. The world directory is READ-ONLY to this code. Nothing here ever
//      writes, renames or deletes inside it -- fs.cp only reads the
//      source. There is deliberately no restore endpoint; rolling a
//      backup back is a manual job for now.
//
//   2. A backup only runs with the Minecraft server fully stopped.
//      Copying a live world gives you a torn snapshot: region files are
//      mid-write and the result can be silently corrupt.
//
//   3. One backup at a time, and a copy in flight is never mistaken for
//      a finished one -- it lands in an ".incomplete-" directory and is
//      only renamed into place once the copy returns. A crash mid-copy
//      leaves obvious litter rather than a plausible-looking bad backup.
//
// backups/ is gitignored, which is also what makes it a useful signal:
// it can only exist on a machine where a backup has actually run.
const BACKUP_DIR = path.join(__dirname, "backups");
const BACKUP_PREFIX = "world-";
const BACKUP_INCOMPLETE_PREFIX = ".incomplete-";
const BACKUP_MANIFEST = "backup.json";

let backupInProgress = false;

function worldDir() {
  return path.join(path.resolve(config.serverDir), "world");
}

// Guard against a config where the panel lives inside the server folder,
// which would have us copying the world into itself, forever.
function assertBackupDirIsSafe() {
  const world = path.resolve(worldDir());
  const dest = path.resolve(BACKUP_DIR);
  if (dest === world || dest.startsWith(world + path.sep)) {
    throw new Error(
      "Refusing to back up: the backup directory is inside the world directory"
    );
  }
}

// Why a backup can or cannot run right now. Shared by the GET (so the UI
// can explain itself) and the POST (which enforces it).
function backupReadiness() {
  if (backupInProgress) return { ok: false, reason: "A backup is already running" };
  if (mcProcess || mcStatus !== "stopped") {
    return {
      ok: false,
      reason: `The Minecraft server must be stopped first (it is "${mcStatus}")`
    };
  }
  if (!fs.existsSync(worldDir())) {
    return { ok: false, reason: `No world directory found at ${worldDir()}` };
  }
  return { ok: true, reason: "" };
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith(BACKUP_PREFIX))
    .map(e => {
      const dir = path.join(BACKUP_DIR, e.name);
      let createdAt = null;
      try {
        createdAt = JSON.parse(fs.readFileSync(path.join(dir, BACKUP_MANIFEST), "utf-8")).createdAt;
      } catch {
        // Manifest missing or unreadable -- fall back to the directory's
        // own timestamp so an older backup still reports an age.
        try { createdAt = fs.statSync(dir).mtime.toISOString(); } catch { /* ignore */ }
      }
      return { name: e.name, createdAt };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

app.get("/api/backups", authMiddleware, requirePermission("view_backups"), (req, res) => {
  try {
    const backups = listBackups();
    res.json({
      backups,
      latest: backups[0] || null,
      inProgress: backupInProgress,
      serverStatus: mcStatus,
      canCreate: backupReadiness()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/backups", authMiddleware, requirePermission("create_backup"), async (req, res) => {
  const ready = backupReadiness();
  if (!ready.ok) {
    audit(req.user.username, "BACKUP_REFUSED", ready.reason);
    return res.status(409).json({ error: ready.reason });
  }

  try {
    assertBackupDirIsSafe();
  } catch (e) {
    audit(req.user.username, "BACKUP_REFUSED", e.message);
    return res.status(409).json({ error: e.message });
  }

  // Claim the lock before the first await so two requests cannot both
  // pass the readiness check above.
  backupInProgress = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalName = BACKUP_PREFIX + stamp;
  const tempDir = path.join(BACKUP_DIR, BACKUP_INCOMPLETE_PREFIX + stamp);
  const finalDir = path.join(BACKUP_DIR, finalName);

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Re-check now that we hold the lock: the server could have been
    // started in the gap, and a torn world copy is the thing we are here
    // to prevent.
    if (mcProcess || mcStatus !== "stopped") {
      throw new Error("The Minecraft server started while the backup was queued");
    }

    await fs.promises.cp(worldDir(), tempDir, { recursive: true, force: false, errorOnExist: false });
    fs.writeFileSync(
      path.join(tempDir, BACKUP_MANIFEST),
      JSON.stringify({ createdAt: new Date().toISOString(), by: req.user.username, source: worldDir() }, null, 2)
    );
    fs.renameSync(tempDir, finalDir);

    audit(req.user.username, "BACKUP_CREATED", finalName);
    res.json({ ok: true, name: finalName });
  } catch (e) {
    // Leave nothing that could pass for a real backup.
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    audit(req.user.username, "BACKUP_FAILED", e.message);
    res.status(500).json({ error: e.message });
  } finally {
    backupInProgress = false;
  }
});

// ── Demo media ──────────────────────────────────────────────
//
// Backs the Demo tab: a gallery of screenshots today, video next, and
// eventually a playable demo. Media is read from `demoDir` (config.json),
// defaulting to public/demo.
//
// Served by express.static rather than streamed through a handler, which
// gets range requests for free -- that matters little for stills but is
// what will make video seeking work without rewriting this.
//
// Note this content is reachable WITHOUT logging in, same as everything
// else under public/. That is the right default for demo material (an
// <img> cannot send an Authorization header anyway), but it does mean
// anything dropped in here is public to whoever can reach the panel.
const DEMO_EXTENSIONS = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image"
  // Roadmap: ".mp4": "video", ".webm": "video" -- express.static already
  // handles the range requests those need.
};

const DEMO_DIR = config.demoDir
  ? path.resolve(config.demoDir)
  : path.join(__dirname, "public", "demo");

function demoType(name) {
  return DEMO_EXTENSIONS[path.extname(name).toLowerCase()] || null;
}

// Only hand out recognised media types. If demoDir is ever pointed
// somewhere with other files in it, they stay unreachable.
app.use("/demo-files", (req, res, next) => {
  if (!demoType(req.path)) return res.status(404).end();
  next();
}, express.static(DEMO_DIR, { fallthrough: false }));

app.get("/api/demo/media", authMiddleware, (req, res) => {
  try {
    if (!fs.existsSync(DEMO_DIR)) return res.json({ items: [], dir: DEMO_DIR });

    const items = fs.readdirSync(DEMO_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && demoType(e.name))
      .map(e => {
        const stat = fs.statSync(path.join(DEMO_DIR, e.name));
        return {
          name: e.name,
          type: demoType(e.name),
          url: "/demo-files/" + encodeURIComponent(e.name),
          sizeBytes: stat.size,
          modified: stat.mtime.toISOString()
        };
      })
      // Plain name order, so a numeric prefix is all you need to control
      // the sequence of a gallery.
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    res.json({ items, dir: DEMO_DIR });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Permissions ─────────────────────────────────────────────
// One list, used by both user-management routes. It used to be declared
// inline at each of them, which is exactly how a new permission ends up
// half-added.
const VALID_PERMS = [
  "start", "restart", "kill", "browse_files", "console",
  "manage_users", "view_audit",
  "view_backups",   // see the backup indicator
  "create_backup"   // run a backup
];

// ── File browser routes ─────────────────────────────────────
function safePath(requestedPath) {
  // Resolve and ensure the path stays inside serverDir
  const serverDir = path.resolve(config.serverDir);
  const resolved = path.resolve(serverDir, requestedPath || ".");
  if (!resolved.startsWith(serverDir)) {
    throw new Error("Access denied: path traversal detected");
  }
  return resolved;
}

app.get("/api/files", authMiddleware, requirePermission("browse_files"), (req, res) => {
  try {
    const target = safePath(req.query.path || ".");
    const stat = fs.statSync(target);

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(target).map(name => {
        try {
          const s = fs.statSync(path.join(target, name));
          return {
            name,
            isDirectory: s.isDirectory(),
            size: s.size,
            modified: s.mtime
          };
        } catch {
          return { name, isDirectory: false, size: 0, modified: null, error: true };
        }
      });
      // Sort: directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const relative = path.relative(config.serverDir, target);
      res.json({ type: "directory", path: relative || ".", entries });
    } else {
      // Return file contents for text files, info only for binary
      const ext = path.extname(target).toLowerCase();
      const textExts = [".txt", ".log", ".json", ".yml", ".yaml", ".properties",
                        ".cfg", ".toml", ".conf", ".ini", ".bat", ".sh", ".md",
                        ".csv", ".mcmeta", ".lang", ".snbt"];
      if (textExts.includes(ext) && stat.size < 2 * 1024 * 1024) {
        const content = fs.readFileSync(target, "utf-8");
        res.json({ type: "file", name: path.basename(target), content, size: stat.size });
      } else {
        res.json({
          type: "file",
          name: path.basename(target),
          content: null,
          size: stat.size,
          message: "Binary or large file — preview not available"
        });
      }
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── User management routes (admin only) ─────────────────────
app.get("/api/users", authMiddleware, requirePermission("manage_users"), (req, res) => {
  const users = loadUsers().map(u => ({
    username: u.username,
    permissions: u.permissions,
    disabled: u.disabled || false,
    createdAt: u.createdAt
  }));
  res.json(users);
});

app.post("/api/users", authMiddleware, requirePermission("manage_users"), async (req, res) => {
  const { username, password, permissions } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (username.length < 3 || username.length > 24) {
    return res.status(400).json({ error: "Username must be 3-24 characters" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be alphanumeric (underscores allowed)" });
  }

  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists" });
  }

  const perms = (permissions || []).filter(p => VALID_PERMS.includes(p));

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  users.push({
    username,
    passwordHash: hash,
    permissions: perms,
    disabled: false,
    createdAt: new Date().toISOString()
  });
  saveUsers(users);
  audit(req.user.username, "USER_CREATED", username);
  res.json({ ok: true });
});

app.put("/api/users/:username", authMiddleware, requirePermission("manage_users"), async (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: "User not found" });

  const { permissions, disabled, password } = req.body;

  if (permissions !== undefined) {
    users[idx].permissions = permissions.filter(p => VALID_PERMS.includes(p));
  }
  if (disabled !== undefined) {
    users[idx].disabled = !!disabled;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    users[idx].passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  }
  saveUsers(users);
  audit(req.user.username, "USER_UPDATED", req.params.username);
  res.json({ ok: true });
});

app.delete("/api/users/:username", authMiddleware, requirePermission("manage_users"), (req, res) => {
  const users = loadUsers();
  const filtered = users.filter(u => u.username.toLowerCase() !== req.params.username.toLowerCase());
  if (filtered.length === users.length) return res.status(404).json({ error: "User not found" });

  // Prevent deleting the last admin
  const remainingAdmins = filtered.filter(u => u.permissions.includes("manage_users"));
  if (remainingAdmins.length === 0) {
    return res.status(400).json({ error: "Cannot delete the last admin user" });
  }

  saveUsers(filtered);
  audit(req.user.username, "USER_DELETED", req.params.username);
  res.json({ ok: true });
});

// ── Audit log route ─────────────────────────────────────────
app.get("/api/audit", authMiddleware, requirePermission("view_audit"), (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_PATH)) return res.json({ lines: [] });
    const raw = fs.readFileSync(AUDIT_PATH, "utf-8");
    const lines = raw.trim().split("\n").slice(-100);
    res.json({ lines });
  } catch {
    res.json({ lines: [] });
  }
});

// ── Catch-all: serve the SPA ────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start listening ─────────────────────────────────────────
app.listen(config.port, "0.0.0.0", () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log("   Minecraft Server Panel");
  console.log(`   Running on http://localhost:${config.port}`);
  console.log(`   LAN access: http://<YOUR_IP>:${config.port}`);
  console.log(`   Server dir: ${config.serverDir}`);
  console.log(`   Panel version: ${PANEL_VERSION}`);
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  if (!fs.existsSync(USERS_PATH) || loadUsers().length === 0) {
    console.log("⚠  No users found. Run 'npm run setup' to create your admin account.");
  }
});
