// ─────────────────────────────────────────────────────────────
// Minecraft Server Panel — server.js
// Main entry point. Run with: node server.js
// ─────────────────────────────────────────────────────────────

const express = require("express");
const path = require("path");
const fs = require("fs");
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
  lockoutMinutes: 15
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`[INIT] Created config.json — edit "serverDir" to point at your server folder.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

const config = loadConfig();

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
  if (loginAttempts[username].count >= config.maxLoginAttempts) {
    loginAttempts[username].lockedUntil = Date.now() + config.lockoutMinutes * 60 * 1000;
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
  loginRateMap[ip] = loginRateMap[ip].filter(t => now - t < 60000);
  if (loginRateMap[ip].length >= 10) {
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
    return res.status(423).json({ error: `Account locked. Try again in ${config.lockoutMinutes} minutes.` });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    recordFailedLogin(username);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.disabled) {
    return res.status(403).json({ error: "Account is disabled" });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    recordFailedLogin(username);
    audit(username, "LOGIN_FAILED");
    return res.status(401).json({ error: "Invalid credentials" });
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

app.post("/api/server/command", authMiddleware, requirePermission("console"), (req, res) => {
  try {
    sendCommand(req.body.command);
    audit(req.user.username, "CONSOLE_CMD", req.body.command);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

  const validPerms = ["start", "restart", "kill", "browse_files", "console", "manage_users", "view_audit"];
  const perms = (permissions || []).filter(p => validPerms.includes(p));

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
  const validPerms = ["start", "restart", "kill", "browse_files", "console", "manage_users", "view_audit"];

  if (permissions !== undefined) {
    users[idx].permissions = permissions.filter(p => validPerms.includes(p));
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
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  if (!fs.existsSync(USERS_PATH) || loadUsers().length === 0) {
    console.log("⚠  No users found. Run 'npm run setup' to create your admin account.");
  }
});
