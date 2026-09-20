"use strict";

// Turn the old, explicitly Codex-authored manual review fragments into one
// JSON-shaped candidate library.  This does not publish anything; the Python
// validator and audit gate decide whether an entry can be used.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const dataDir = path.join(ROOT, "data");
const entries = {};
const sources = new Set();
const files = fs.readdirSync(dataDir)
  .filter((name) => /^audited-legacy-.+\.js$/u.test(name))
  .sort();

for (const name of files) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dataDir, name), "utf8"), context, { filename: name });
  const library = context.window.WORD_AI_EXAMPLE_LIBRARY || {};
  if (library.source) sources.add(String(library.source));
  Object.assign(entries, library.entries || {});
}

const payload = {
  source: "Codex-authored manual review candidates; requires strict validation before publication",
  importedFrom: files.length,
  priorSourceLabels: [...sources].sort(),
  entries,
};
const target = path.join(dataDir, "codex-reviewed-examples.js");
fs.writeFileSync(target, `window.WORD_CODEX_REVIEWED_EXAMPLES = ${JSON.stringify(payload)};\n`, "utf8");
console.log(JSON.stringify({ files: files.length, entries: Object.keys(entries).length, target }, null, 2));
