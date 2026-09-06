# ⛏ Minecraft Server Panel

A secure, self-hosted web panel for managing a CurseForge modded Minecraft server on Windows 10.

## Features

- **Authenticated access** — Username/password login with bcrypt-hashed passwords
- **Per-user permissions** — Granular whitelist controlling who can start, stop, browse files, etc.
- **Server controls** — Start, restart, graceful stop, and force kill the Minecraft server
- **Live console** — Streaming server output with command input
- **File browser** — Browse and view server config files, logs, etc. (read-only)
- **User management** — Admin UI to add, edit, disable, or delete users
- **Audit log** — Every action is logged with timestamp and username
- **Account lockout** — Brute-force protection (5 failed attempts → 15 min lockout)

---

## Quick Start

### Prerequisites

- **Node.js 18+** installed on your Windows 10 machine
  - Download from https://nodejs.org
- A CurseForge modded server already set up with a `start.bat` launch script

### 1. Install

```bash
cd minecraft-panel
npm install
```

### 2. Configure

Open `config.json` (auto-created on first run) and update:

```json
{
  "port": 3847,
  "serverDir": "C:\\Path\\To\\Your\\MinecraftServer",
  "startCommand": "start.bat"
}
```

| Field | Description |
|-------|-------------|
| `port` | Web panel port (default 3847) |
| `serverDir` | **Full path** to your CurseForge server folder |
| `startCommand` | The `.bat` file that launches the server (usually `start.bat` or `ServerStart.bat`) |
| `jwtSecret` | Auto-generated — don't touch unless you want to invalidate all sessions |
| `tokenExpiryHours` | How long login sessions last (default 8 hours) |
| `maxLoginAttempts` | Failed logins before lockout (default 5) |
| `lockoutMinutes` | Lockout duration (default 15) |

### 3. Create Your Admin Account

```bash
npm run setup
```

This will prompt you for a username and password. The password is hashed with bcrypt (12 rounds) before storage — plaintext is never saved.

### 4. Start the Panel

```bash
npm start
```

You'll see:

```
═══════════════════════════════════════════════════════
   Minecraft Server Panel
   Running on http://localhost:3847
   LAN access: http://<YOUR_IP>:3847
═══════════════════════════════════════════════════════
```

Open the URL in a browser. Your friends on the same network can reach it via your local IP.

---

## Permissions

Each user has a set of permission flags. You can mix and match per user:

| Permission | Allows |
|------------|--------|
| `start` | Start the Minecraft server |
| `restart` | Restart the server |
| `kill` | Graceful stop or force kill |
| `browse_files` | View server files and configs |
| `console` | Send commands to the server console |
| `manage_users` | Add, edit, disable, delete users |
| `view_audit` | View the audit log |

**Example roles you might set up:**

- **Admin** — All permissions
- **Operator** — `start`, `restart`, `kill`, `console`
- **Moderator** — `start`, `restart`, `console`
- **Viewer** — `browse_files` only

---

## Security Notes

This is an **alpha** tool for trusted LAN use. Some things to be aware of:

1. **HTTPS is not included.** Traffic on your LAN is unencrypted. If you expose this to the internet, put it behind a reverse proxy (nginx, Caddy) with TLS.

2. **Passwords are bcrypt-hashed** at 12 salt rounds. The `data/users.json` file contains hashes, never plaintext.

3. **JWT tokens** are signed with a random secret generated on first run. Deleting `config.json` will invalidate all sessions.

4. **File browser is read-only** and sandboxed to your `serverDir`. Path traversal attempts are blocked.

5. **Audit log** records every login, server action, and user management change.

6. **Brute-force protection** locks accounts after repeated failed logins.

---

## LAN Access

To let friends connect from other machines on your network:

1. Find your local IP: open Command Prompt and run `ipconfig`
2. Look for your IPv4 address (e.g., `192.168.1.100`)
3. Share the URL: `http://192.168.1.100:3847`
4. You may need to allow port 3847 through Windows Firewall:
   - Windows Security → Firewall → Advanced → Inbound Rules → New Rule
   - Port → TCP 3847 → Allow → Name it "MC Panel"

---

## File Structure

```
minecraft-panel/
├── server.js          # Express backend (API + static files)
├── setup.js           # Admin account creation script
├── config.json        # Panel configuration (auto-created)
├── package.json
├── public/
│   └── index.html     # Full single-page frontend
├── data/
│   ├── users.json     # User accounts (passwords are hashed)
│   └── audit.log      # Action audit trail
└── README.md
```

---

## Troubleshooting

**"Server directory not found"**
→ Update `serverDir` in `config.json` to the correct path. Use double backslashes: `C:\\Users\\You\\McServer`

**"Start script not found"**
→ Check that `startCommand` in `config.json` matches your actual `.bat` filename.

**Server starts but console shows no output**
→ Some CurseForge scripts launch Java in a new window. You may need to edit `start.bat` to remove `start` or `cmd /c` prefixes so Java runs in the same process.

**Can't connect from another PC**
→ Check Windows Firewall (see LAN Access section above).
