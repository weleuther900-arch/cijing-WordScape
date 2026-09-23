"use strict";

// Builds a local, compact lookup index from the MIT-licensed ECDICT dataset.
// The resulting file lives under data/ and is deliberately excluded from Git.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
const SOURCE_URLS = [
  `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/ecdict.csv`,
  `https://github.com/skywind3000/ECDICT/raw/${ECDICT_COMMIT}/ecdict.csv`
];
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "offline-dictionary.json");
const execFileAsync = promisify(execFile);

function verifyCsv(text) {
  const value = String(text || "").replace(/^\uFEFF/, "");
  if (!value.startsWith("word,")) throw new Error("downloaded file is not a valid ECDICT CSV");
  return value;
}
async function downloadWithFetch(sourceUrl) {
  const response = await fetch(sourceUrl, { headers: { "User-Agent": "WordScape-local-dictionary-installer" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return verifyCsv(await response.text());
}
async function downloadWithCurl(sourceUrl) {
  const temporary = path.join(ROOT, `.ecdict-download-${process.pid}.csv`);
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  try {
    await fs.rm(temporary, { force: true });
    await execFileAsync(command, ["--fail", "--location", "--retry", "1", "--connect-timeout", "15", "--max-time", "120", "--silent", "--show-error", "--output", temporary, sourceUrl], { windowsHide: true, maxBuffer: 1024 * 1024 });
    return verifyCsv(await fs.readFile(temporary, "utf8"));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function downloadEcdict() {
  let lastError;
  for (const sourceUrl of SOURCE_URLS) {
    for (const [label, downloader] of [["Node", downloadWithFetch], ["系统下载器", downloadWithCurl]]) {
      try {
        console.log(`Downloading ECDICT source via ${label}…`);
        return { sourceUrl, text: await downloader(sourceUrl) };
      } catch (error) {
        lastError = error;
        console.warn(`ECDICT source attempt failed: ${error?.message || error}`);
      }
    }
  }
  throw new Error(`ECDICT download failed after all fallbacks: ${lastError?.message || lastError}`);
}

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
  const { sourceUrl, text } = await downloadEcdict();
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
    sourceUrl,
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
