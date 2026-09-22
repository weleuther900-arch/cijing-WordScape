"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publicDir = path.resolve(__dirname, "../public");
function readWindowAsset(file, globalName) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context.window[globalName];
}
function usableSense(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^[.。…·•\s-]+$/u.test(text) && !/(?:词性|中文释义)(?:未标注|待补充)/u.test(text);
}
function usablePartOfSpeech(value) {
  return Boolean(String(value || "").trim()) && !/(?:词性)(?:未标注|待补充)/u.test(String(value));
}

const library = readWindowAsset(path.join(publicDir, "word-senses.js"), "WORD_SENSE_LIBRARY");
const entries = library.entries || {};
assert.equal(Object.keys(entries).length, 5487, "The bundled wordbook must keep all 5,487 definition records.");
assert.deepEqual(Array.from(library.missing || []), [], "No bundled word may be missing a definition record.");

const invalidWords = [];
for (const [word, record] of Object.entries(entries)) {
  const senses = Array.isArray(record.senses) ? record.senses : [];
  if (!senses.length || senses.some((entry) => !usablePartOfSpeech(entry.partOfSpeech) || !usableSense(entry.sense))) invalidWords.push(word);
}
assert.deepEqual(invalidWords, [], "Every bundled sense must have a usable part of speech and Chinese definition.");

const irregular = { children: "child", feet: "foot", geese: "goose", men: "man", mice: "mouse", people: "person", teeth: "tooth", women: "woman" };
function senseKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (entries[key]) return key;
  const candidates = [irregular[key]];
  if (key.endsWith("ies") && key.length > 4) candidates.push(key.slice(0, -3) + "y");
  if (key.endsWith("ied") && key.length > 4) candidates.push(key.slice(0, -3) + "y");
  if (key.endsWith("es") && key.length > 4) candidates.push(key.slice(0, -2), key.slice(0, -1));
  if (key.endsWith("s") && key.length > 3) candidates.push(key.slice(0, -1));
  if (key.endsWith("ing") && key.length > 5) candidates.push(key.slice(0, -3), key.slice(0, -3) + "e", key.slice(0, -4));
  if (key.endsWith("ed") && key.length > 4) candidates.push(key.slice(0, -1), key.slice(0, -2), key.slice(0, -3));
  return candidates.find((candidate) => candidate && entries[candidate]) || key;
}
assert.equal(senseKey("dispersed"), "disperse");
assert.equal(senseKey("groaned"), "groan");
assert.equal(senseKey("retailed"), "retail");

function phrases(word) {
  return new Set(entries[word].senses.flatMap((entry) => String(entry.sense).split(/[；;、，,／/]/)).map((value) => value.replace(/[（(【\[].*?[）)】\]]/g, "").replace(/\s+/g, "").trim()).filter((value) => value.length >= 2));
}
function confusable(left, right) {
  const leftPhrases = phrases(left); const rightPhrases = phrases(right);
  return Array.from(leftPhrases).some((leftPhrase) => Array.from(rightPhrases).some((rightPhrase) => leftPhrase === rightPhrase || leftPhrase.includes(rightPhrase) || rightPhrase.includes(leftPhrase)));
}
assert.equal(confusable("moan", "groan"), true, "moan and groan must be rejected as an ambiguous pair.");
assert.equal(confusable("moan", "beef"), true, "Shared complaint senses must be rejected.");
assert.equal(confusable("moan", "complain"), true, "Shared complaint senses must be rejected.");

const released = new Set(readWindowAsset(path.join(publicDir, "released-example-words.js"), "WORD_RELEASED_EXAMPLE_WORDS").map((word) => String(word).toLowerCase()));
const records = new Map();
for (const file of fs.readdirSync(path.join(publicDir, "ai-examples")).filter((name) => name.endsWith(".js"))) {
  const chunk = readWindowAsset(path.join(publicDir, "ai-examples", file), "WORD_AI_EXAMPLE_CHUNK");
  for (const [word, record] of Object.entries((chunk && chunk.entries) || {})) records.set(word, record);
}
const unresolved = [];
for (const word of released) {
  const record = records.get(word);
  const available = entries[word] && entries[word].senses || [];
  if (!record || !available.length) {
    unresolved.push(word);
    continue;
  }
  const groups = (record.senseGroups || []).map((group) => {
    const ids = Array.isArray(group.sourceSenseIds) ? group.sourceSenseIds.map(String) : [];
    const matched = ids.length ? available.filter((entry) => ids.includes(String(entry.id))) : [];
    if (ids.length && !matched.length) return null;
    return matched.length ? { id: group.id, partOfSpeech: matched[0].partOfSpeech, sense: matched.map((entry) => entry.sense).join("；") } : group;
  }).filter(Boolean);
  const groupIds = new Set(groups.filter((group) => usablePartOfSpeech(group.partOfSpeech) && usableSense(group.sense)).map((group) => group.id));
  if (!groupIds.size || !(record.examples || []).some((example) => groupIds.has(example.senseId) && example.sentence && example.translation)) unresolved.push(word);
}
assert.deepEqual(unresolved, [], "Every released word must resolve to a valid Chinese sense and at least one verified example.");

const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
assert.match(appSource, /meaningsAreConfusable/);
assert.match(appSource, /hasUsableWordDefinition/);
assert.doesNotMatch(appSource, /const confusable = samePart/);
assert.match(appSource, /data-number-setting="dailyNewTarget"/);
assert.doesNotMatch(appSource, /data-number-setting="reviewGate"/);

console.log("Review content verification passed: 5,487 definitions complete, inflections resolve, ambiguous pairs are blocked, and released examples remain linked.");
