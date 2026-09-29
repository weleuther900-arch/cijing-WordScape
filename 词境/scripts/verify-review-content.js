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
  return Boolean(text) && /\p{Script=Han}/u.test(text) && !/[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(text) && !/^[.。…·•\s-]+$/u.test(text) && !/(?:词性|中文释义)(?:未标注|待补充)/u.test(text);
}
function usablePartOfSpeech(value) {
  const parts = String(value || "").trim().split(/\s*\/\s*/);
  return parts.length > 0 && parts.every((part) => /^(?:n|v|adj|adv|prep|pron|conj|aux|art|det|num|int)\.$/i.test(part));
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
assert.equal(Object.values(entries).flatMap((record) => record.senses || []).some((entry) => /^(?:计算机|医学|法律)$/.test(entry.partOfSpeech)), false, "Specialist domain labels must never become parts of speech.");
assert.deepEqual(Array.from(entries.laptop.senses, ({ partOfSpeech, sense }) => ({ partOfSpeech, sense })), [{ partOfSpeech: "n.", sense: "笔记本电脑；便携式电脑" }]);
assert.deepEqual(Array.from(entries.ounce.senses, ({ partOfSpeech, sense }) => ({ partOfSpeech, sense })), [{ partOfSpeech: "n.", sense: "盎司" }, { partOfSpeech: "n.", sense: "少量" }, { partOfSpeech: "n.", sense: "雪豹" }]);
assert.equal(entries["o'clock"].senses[0].partOfSpeech, "adv.");
assert.equal(entries.yes.senses[0].partOfSpeech, "int.");
assert.equal(entries.every.senses[0].partOfSpeech, "det.");
assert.deepEqual(Array.from(entries.descent.senses, ({ id, sense }) => ({ id, sense })), [{ id: "n-1", sense: "下降；下行" }, { id: "n-2", sense: "家系；出身" }, { id: "n-3", sense: "侵袭；突然来临" }, { id: "n-4", sense: "血统；世系" }, { id: "n-5", sense: "下降" }, { id: "n-6", sense: "世代" }]);
assert.deepEqual(Array.from(entries.kid.senses, ({ id, partOfSpeech, sense }) => ({ id, partOfSpeech, sense })), [{ id: "n-1", partOfSpeech: "n.", sense: "小山羊" }, { id: "n-2", partOfSpeech: "n.", sense: "小山羊皮" }, { id: "n-3", partOfSpeech: "n.", sense: "小孩；儿童" }, { id: "n-4", partOfSpeech: "v.", sense: "开玩笑；戏弄；哄骗" }]);
assert.equal(entries.liner.senses.find((entry) => entry.id === "n-3").sense, "定期客轮；班轮");
assert.equal(entries.liner.senses.find((entry) => entry.id === "n-4").sense, "内衬；衬里");
assert.equal(entries.liner.senses.find((entry) => entry.id === "n-5").sense, "衬垫；防渗膜");

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

const bundledWordbook = JSON.parse(fs.readFileSync(path.join(publicDir, "bundled-imports", "27-one.json"), "utf8"));
assert.equal(bundledWordbook.words.length, 5487, "The built-in wordbook must keep all 5,487 words.");
assert.equal(new Set(bundledWordbook.words.map((word) => String(word).toLowerCase())).size, 5487, "The built-in wordbook must not contain duplicate headwords.");
assert.deepEqual(bundledWordbook.words.filter((word) => !entries[senseKey(word)]), [], "Every built-in word must resolve to a bundled Chinese definition.");

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
const mergedContextGroups = [];
function usableContextPartOfSpeech(value) {
  return usablePartOfSpeech(value) || (Boolean(String(value || "").trim()) && !/(?:词性)(?:未标注|待补充)/u.test(String(value)));
}
for (const word of released) {
  const record = records.get(word);
  const available = entries[word] && entries[word].senses || [];
  if (!record || !available.length) {
    unresolved.push(word);
    continue;
  }
  const groups = (record.senseGroups || []).map((group) => {
    const ids = Array.isArray(group.sourceSenseIds) ? group.sourceSenseIds.map(String) : [];
    if (ids.length !== 1) {
      mergedContextGroups.push(`${word}:${String(group.id || "")}`);
      return null;
    }
    const matched = available.find((entry) => String(entry.id) === ids[0]);
    if (matched) return { id: group.id, partOfSpeech: matched.partOfSpeech, sense: matched.sense };
    if (group.contextReviewed && usableContextPartOfSpeech(group.partOfSpeech) && usableSense(group.sense)) return group;
    return null;
  }).filter(Boolean);
  const groupIds = new Set(groups.filter((group) => usableContextPartOfSpeech(group.partOfSpeech) && usableSense(group.sense)).map((group) => group.id));
  if (!groupIds.size || !(record.examples || []).every((example) => groupIds.has(example.senseId) && example.sentence && example.translation)) unresolved.push(word);
}
assert.deepEqual(mergedContextGroups, [], "A sentence context group must contain exactly one dictionary sense.");
assert.deepEqual(unresolved, [], "Every released word must resolve to one valid Chinese context sense for every verified example.");

const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
assert.match(appSource, /meaningsAreConfusable/);
assert.match(appSource, /ids\.length !== 1/, "The app must reject merged sense groups before rendering 本句释义。");
assert.match(appSource, /hasUsableWordDefinition/);
assert.doesNotMatch(appSource, /const confusable = samePart/);
assert.match(appSource, /data-number-setting="dailyNewTarget"/);
assert.doesNotMatch(appSource, /data-number-setting="reviewGate"/);
assert.match(appSource, /browserAssetLoads\.delete\(src\)/, "A failed definition asset request must be retryable.");
assert.match(appSource, /data-retry-senses/, "A failed definition load must expose a retry control.");
for (const view of ["词表", "学习", "复习", "记忆"]) assert.match(appSource, new RegExp(`renderSenseLibraryGate\\("${view}"\\)`), `${view} must wait for the complete definition library.`);
assert.equal((appSource.match(/中文释义待补充/g) || []).length, 1, "The legacy placeholder may only remain in the migration detector and must never be rendered.");
assert.equal((appSource.match(/词性待补充/g) || []).length, 1, "The legacy part-of-speech placeholder may only remain in the migration detector and must never be rendered.");
assert.match(appSource, /unresolvedWords\.length.*已停止导出/, "CSV export must stop instead of writing a missing definition.");
assert.match(appSource, /const importable = fresh\.filter/, "Imports must filter out words without a reliable dictionary definition.");
assert.match(appSource, /if \(!importable\.length\).*未执行导入/, "An unresolved import must stop before writing an empty definition.");

console.log("Review content verification passed: 5,487 entries have standard parts of speech and Chinese senses, corrected dictionary records resolve, ambiguous pairs are blocked, and released examples remain linked.");
