"use strict";

// Builds a local, compact lookup index from the MIT-licensed ECDICT dataset.
// The resulting file lives under data/ and is deliberately excluded from Git.
const fs = require("node:fs/promises");
const path = require("node:path");

const ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
const SOURCE_URL = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/ecdict.csv`;
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "offline-dictionary.json");

function parseCsv(text, onRow) {
  let field = ""; let row = []; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { row.push(field); field = ""; continue; }
    if (character === "\n") { row.push(field.replace(/\r$/, "")); onRow(row); row = []; field = ""; continue; }
    field += character;
  }
  if (field || row.length) { row.push(field); onRow(row); }
}

function compactTranslation(value) {
  return String(value || "").replace(/\\n/g, "\n").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  console.log("Downloading the open ECDICT source…");
  const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "WordScape-local-dictionary-installer" }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`ECDICT download failed: HTTP ${response.status}`);
  const text = await response.text();
  const entries = Object.create(null); let header = null; let count = 0;
  parseCsv(text, (row) => {
    if (!header) { header = row.map((name) => name.trim()); return; }
    const valueFor = (name) => row[header.indexOf(name)] || "";
    const word = valueFor("word").trim().toLowerCase();
    const translation = compactTranslation(valueFor("translation"));
    if (!word || !translation || !/^[a-z][a-z '\-]*$/i.test(word) || entries[word]) return;
    entries[word] = [valueFor("phonetic").trim(), translation, valueFor("pos").trim()];
    count += 1;
  });
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = {
    version: 1,
    source: "ECDICT",
    license: "MIT",
    sourceUrl: `https://github.com/skywind3000/ECDICT/tree/${ECDICT_COMMIT}`,
    installedAt: new Date().toISOString(),
    entries
  };
  const temporary = `${OUTPUT_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
  await fs.rename(temporary, OUTPUT_FILE);
  console.log(`Installed ${count.toLocaleString("en-US")} offline dictionary entries.`);
  console.log(`Saved locally at ${OUTPUT_FILE}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
