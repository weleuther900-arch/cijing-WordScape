"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const oxfordUrl = "https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000?dataset=english&list=ox3000";
const ecdictCommit = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";

function readWindowAsset(file, globalName) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context.window[globalName];
}

function decodeHtml(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

async function oxfordHtml() {
  if (process.argv[2]) return fs.readFileSync(path.resolve(process.argv[2]), "utf8");
  const response = await fetch(oxfordUrl, { headers: { "User-Agent": "WordScape-dictionary-audit" }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Oxford word-list download failed: HTTP ${response.status}`);
  return response.text();
}

function parseOxfordParts(html) {
  const entries = new Map();
  const pattern = /<li data-hw="([^"]+)"[^>]*>[\s\S]*?<span class="pos">([^<]+)<\/span>/g;
  for (const match of html.matchAll(pattern)) {
    const word = decodeHtml(match[1]).trim().toLowerCase();
    const part = decodeHtml(match[2]).trim().toLowerCase();
    if (!entries.has(word)) entries.set(word, new Set());
    entries.get(word).add(part);
  }
  return entries;
}

const oxfordToProject = new Map([
  ["noun", "n."], ["verb", "v."], ["linking verb", "v."], ["adjective", "adj."], ["adverb", "adv."],
  ["preposition", "prep."], ["pronoun", "pron."], ["conjunction", "conj."], ["modal verb", "aux."],
  ["auxiliary verb", "aux."], ["indefinite article", "art."], ["definite article", "art."],
  ["determiner", "det."], ["number", "num."], ["ordinal number", "num."], ["exclamation", "int."]
]);
const documentedOxfordPartialListExceptions = new Set(["lot"]);
const standardPart = /^(?:n|v|adj|adv|prep|pron|conj|aux|art|det|num|int)\.$/;

async function main() {
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, "data", "offline-dictionary.json"), "utf8"));
  assert.equal(dictionary.source, "ECDICT");
  assert.match(dictionary.sourceUrl || "", new RegExp(ecdictCommit));

  const words = JSON.parse(fs.readFileSync(path.join(publicDir, "bundled-imports", "27-one.json"), "utf8")).words.map((word) => String(word).toLowerCase());
  const senses = readWindowAsset(path.join(publicDir, "word-senses.js"), "WORD_SENSE_LIBRARY").entries || {};
  assert.equal(Object.keys(senses).length, words.length);

  const badChinese = [];
  const badParts = [];
  for (const word of words) {
    for (const entry of senses[word]?.senses || []) {
      if (!/\p{Script=Han}/u.test(String(entry.sense || "")) || /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(String(entry.sense || ""))) badChinese.push({ word, entry });
      for (const part of String(entry.partOfSpeech || "").split(/\s*\/\s*/)) if (!standardPart.test(part)) badParts.push({ word, part });
    }
  }
  assert.deepEqual(badChinese, [], "Every sense must contain usable Chinese and no corrupt Cyrillic/Greek fragments.");
  assert.deepEqual(badParts, [], "Every sense must use a supported grammatical part of speech.");

  const oxford = parseOxfordParts(await oxfordHtml());
  assert.ok(oxford.size >= 4900, `Oxford list parsing returned only ${oxford.size} headwords.`);
  const covered = words.filter((word) => oxford.has(word));
  assert.ok(covered.length >= 3800, `Oxford coverage unexpectedly fell to ${covered.length} project words.`);

  const conflicts = [];
  for (const word of covered) {
    const projectParts = new Set((senses[word]?.senses || []).flatMap((entry) => String(entry.partOfSpeech).split(/\s*\/\s*/)));
    const oxfordParts = new Set([...oxford.get(word)].map((part) => oxfordToProject.get(part)).filter(Boolean));
    if (![...projectParts].some((part) => oxfordParts.has(part)) && !documentedOxfordPartialListExceptions.has(word)) {
      conflicts.push({ word, projectParts: [...projectParts], oxfordParts: [...oxford.get(word)] });
    }
  }
  assert.deepEqual(conflicts, [], "Oxford and project parts of speech must intersect for every covered word except documented partial-list cases.");

  console.log(JSON.stringify({
    projectWords: words.length,
    ecdictEntries: Object.keys(dictionary.entries || {}).length,
    ecdictCommit,
    oxfordHeadwords: oxford.size,
    oxfordCoveredProjectWords: covered.length,
    oxfordPartialListExceptions: [...documentedOxfordPartialListExceptions],
    invalidChineseSenses: badChinese.length,
    invalidPartsOfSpeech: badParts.length,
    unresolvedOxfordConflicts: conflicts.length
  }));
}

main().catch((error) => { console.error(error.stack || error.message || error); process.exitCode = 1; });