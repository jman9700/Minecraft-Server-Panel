// ─────────────────────────────────────────────────────────────
// setup.js — Create your first admin account
// Run with: npm run setup   (or:  node setup.js)
// ─────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const readline = require("readline");

const USERS_PATH = path.join(__dirname, "data", "users.json");
const SALT_ROUNDS = 12;

// Ensure data directory
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = "";
    const onData = (ch) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (c === "\u007F" || c === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (c === "\u0003") {
        process.exit();
      } else {
        input += c;
        process.stdout.write("*");
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

(async () => {
  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("   Minecraft Server Panel — Admin Setup");
  console.log("═══════════════════════════════════════════════════");
  console.log("");

  // Load existing users
  let users = [];
  if (fs.existsSync(USERS_PATH)) {
    users = JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
  }

  const existingAdmins = users.filter(u => u.permissions.includes("manage_users"));
  if (existingAdmins.length > 0) {
    console.log(`  Existing admin(s): ${existingAdmins.map(u => u.username).join(", ")}`);
    const proceed = await ask("  Create another admin? (y/n): ");
    if (proceed.toLowerCase() !== "y") {
      console.log("  Aborted.");
      rl.close();
      process.exit(0);
    }
  }

  let username;
  while (true) {
    username = await ask("  Username (3-24 chars, alphanumeric): ");
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      console.log("  ✗ Invalid username. Use 3-24 alphanumeric characters or underscores.");
      continue;
    }
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      console.log("  ✗ Username already exists.");
      continue;
    }
    break;
  }

  let password;
  while (true) {
    password = await askHidden("  Password (min 8 chars): ");
    if (password.length < 8) {
      console.log("  ✗ Password must be at least 8 characters.");
      continue;
    }
    const confirm = await askHidden("  Confirm password: ");
    if (password !== confirm) {
      console.log("  ✗ Passwords do not match.");
      continue;
    }
    break;
  }

  console.log("\n  Hashing password...");
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  users.push({
    username,
    passwordHash: hash,
    permissions: ["start", "restart", "kill", "browse_files", "console", "manage_users", "view_audit"],
    disabled: false,
    createdAt: new Date().toISOString()
  });

  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));

  console.log("");
  console.log(`  ✓ Admin user "${username}" created with full permissions.`);
  console.log("  ✓ Password hash stored securely with bcrypt.");
  console.log("");
  console.log("  Start the panel with:  npm start");
  console.log("");

  rl.close();
  process.exit(0);
})();
