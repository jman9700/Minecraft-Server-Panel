#!/usr/bin/env node
/**
 * Computes the fingerprint of the panel's source, the same way server.js
 * does at boot and exposes at GET /api/version.
 *
 * One implementation shared by everything that needs to know what the
 * panel *should* be running: panel-version.setup.ts (the suite's gate)
 * and the CI workflow (waiting for the box to catch up after staging).
 * server.js keeps its own copy on purpose -- it fingerprints itself and
 * must stay self-contained -- so if you change the algorithm, change it
 * in both. There is a matching note there.
 *
 * Usage:  node scripts/panel-fingerprint.js [panelDir]
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PANEL_SOURCE_FILES = ["server.js", path.join("public", "index.html")];

function panelFingerprint(panelDir) {
  const hash = crypto.createHash("sha256");
  for (const rel of PANEL_SOURCE_FILES) {
    const file = path.join(panelDir, rel);
    if (!fs.existsSync(file)) {
      throw new Error(`Cannot fingerprint the panel: ${file} is missing.`);
    }
    // Forward-slash the key and normalise line endings: the repo checks
    // out CRLF on Windows and LF on the CI runner, and we are comparing
    // content, not checkout style.
    hash.update(rel.split(path.sep).join("/"));
    hash.update(fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n"));
  }
  return hash.digest("hex").slice(0, 12);
}

const DEFAULT_PANEL_DIR = path.resolve(__dirname, "..", "mcpanel0.5", "minecraft-panel");

module.exports = { panelFingerprint, PANEL_SOURCE_FILES, DEFAULT_PANEL_DIR };

if (require.main === module) {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PANEL_DIR;
  process.stdout.write(panelFingerprint(dir) + "\n");
}
