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
    const reviewedSemanticSense = Boolean(group.contextReviewed && group.semanticDistinct && usableContextPartOfSpeech(group.partOfSpeech) && usableSense(group.sense));
    if (ids.length !== 1) {
      if (reviewedSemanticSense) return group;
      mergedContextGroups.push(`${word}:${String(group.id || "")}`);
      return null;
    }
    const matched = available.find((entry) => String(entry.id) === ids[0]);
    if (matched) return { id: group.id, partOfSpeech: matched.partOfSpeech, sense: matched.sense };
    if (reviewedSemanticSense) return group;
    return null;
  }).filter(Boolean);
  const groupIds = new Set(groups.filter((group) => usableContextPartOfSpeech(group.partOfSpeech) && usableSense(group.sense)).map((group) => group.id));
  if (!groupIds.size || !(record.examples || []).every((example) => groupIds.has(example.senseId) && example.sentence && example.translation)) unresolved.push(word);
}
assert.deepEqual(mergedContextGroups, [], "A sentence context group must be atomic or explicitly reviewed as one distinct learner-facing meaning.");
assert.deepEqual(unresolved, [], "Every released word must resolve to one valid Chinese context sense for every verified example.");

const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
assert.match(appSource, /meaningsAreConfusable/);
assert.match(appSource, /group\?\.semanticDistinct/, "The app may render a merged group only after semantic-distinct review.");
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

assert.match(appSource, /\{ id: "day30", label: "Mastered"/, "The final memory step must be named Mastered.");
assert.match(appSource, /function memoryIsMastered\(word\) \{ return memoryStepComplete\(word, "day30"\); \}/, "Mastered must be determined by the final memory step.");
assert.match(appSource, /\{ id: "all", label: "All", count: words\.length \}/, "Memory directories must include All.");
assert.match(appSource, /\{ id: "learning", label: "Learning"/, "Memory directories must include Learning.");
assert.match(appSource, /\{ id: "mastered", label: "Mastered"/, "Memory directories must include Mastered.");
assert.match(appSource, /const serials = new Map\(filtered\.map\(\(word, index\) => \[word\.id, index \+ 1\]\)\)/, "Each memory directory must renumber its filtered rows from one.");
assert.match(appSource, /function memoryWordHasBeenLearned\(word\) \{ return Boolean\(word\?\.learningSeen \|\| word\?\.learnedAt\); \}/, "The memory table must only contain words that have been learned.");
assert.match(appSource, /activeWords\(\)\.filter\(memoryWordHasBeenLearned\)/, "Unlearned words must be excluded from all memory directories.");
assert.match(appSource, /captureMemoryTableScrollPosition/, "Memory step updates must preserve horizontal table position.");
assert.match(appSource, /const preservedScrollLeft = captureMemoryTableScrollPosition\(\);/, "Mastered updates must capture the current horizontal table position before rendering.");
assert.match(appSource, /memoryTableScrollLeft = preservedScrollLeft;\s*render\(\);/, "Mastered updates must restore the captured horizontal table position after rendering.");
assert.match(appSource, /memo: "", memoUpdatedAt: null/, "Each notebook memory table must include a personal memo.");
assert.match(appSource, /data-memory-memo/, "The memory page must render its editable personal memo.");
assert.match(appSource, /memory-side-stack/, "The personal memo must live outside the directory sidebar.");
assert.match(appSource, /class="memory-memo-title" id="memory-memo-title">Notes<\/h3><textarea data-memory-memo/, "The memo must be visually blank except for its concise English Notes title.");
assert.doesNotMatch(appSource, /data-memory-memo[^>]*placeholder=/, "The blank memo must not include an instructional placeholder.");
assert.match(appSource, /function updateMemoryMemo\(value\)/, "Memo edits must be persisted without rerendering the page.");
assert.match(appSource, /persist\(\{ defer: true, silent: true \}\)/, "Memo typing must use deferred automatic saving.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-memo/, "The memory memo must retain its separate sticky-note styling.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /single blank sheet/, "The separate memo must retain its single blank-sheet styling.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /same visual system as the directory card/, "The memo must keep the directory card's background and corner system.");
assert.doesNotMatch(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-side-stack \.memory-memo textarea \{[^}]*repeating-linear-gradient/, "The single-layer memo must not contain internal ruled lines.");
assert.match(appSource, /tableScroller\.scrollLeft = memoryTableScrollLeft/, "The memory table must restore its horizontal position after rendering.");
assert.doesNotMatch(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /translateX\(14px\)/, "Mastered list exit must not slide the table horizontally.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-mastered-column-fix/, "The final Mastered column must retain an explicit responsive layout.");
assert.doesNotMatch(appSource, /memoryPendingDirectoryExits/, "A Mastered word must not remain in Learning while waiting for sync.");
assert.match(appSource, /movesToMastered.*animateMasteredMemoryRow/, "Completing Mastered from Learning must animate the immediate list exit.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-row-to-mastered/, "The Mastered list exit animation must be available in the published stylesheet.");
assert.match(appSource, /data-memory-examples/, "Each memory serial must open that word's verified examples.");
assert.match(appSource, /memoryExampleSentenceMarkup/, "Memory examples must mark the target form within each sentence.");
assert.match(appSource, /data-speak-sentence="\$\{escapeHtml\(context\.sentence\)\}"/, "Every memory example sentence must have its own speech control.");
assert.match(appSource, /const contexts = memoryExampleLoading \? \[\] : memoryExampleContexts\(word\)/, "Memory examples must wait for the complete set instead of showing a fallback sentence first.");
assert.match(appSource, /preloadAiContexts\(\[word\], "memory", \{ renderAfterLoad: false \}\)/, "Memory example loading must perform only the final stable render.");
assert.match(appSource, /requestVersion !== memoryExampleLoadVersion/, "Stale memory example requests must not redraw a newer panel.");
assert.match(appSource, /verifiedExampleContexts\(word\)/, "Memory examples must use verified sentence contexts and Chinese translations.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-example-sheet/, "The published stylesheet must include the responsive memory example sheet.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-example-sentence-row/, "The published stylesheet must align each sentence speech control consistently.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /iPhone: keep the word header fixed/, "The iPhone example panel must keep its header separate from its scroll area.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-example-list,[\s\S]*overflow-y: auto/, "The iPhone example list must provide its own vertical scroll area.");
assert.match(appSource, /function locateMemorySearch\(\)/, "Memory search must locate a word instead of only filtering the table.");
assert.match(appSource, /memoryWindowStart = Math\.floor/, "Memory search must open the target row's table window.");
assert.match(appSource, /row\.scrollIntoView/, "Memory search must scroll to the located row.");
assert.doesNotMatch(appSource, /memoryFilterIncludes\(word, prefs\.filter\) && memoryMatchesSearch\(word, memorySearch\)/, "Memory search must not shrink the table to matching words.");
assert.match(fs.readFileSync(path.join(publicDir, "enhancements.css"), "utf8"), /memory-search-target/, "The located memory row must receive a visible highlight style.");console.log("Review content verification passed: 5,487 entries have standard parts of speech and Chinese senses, corrected dictionary records resolve, ambiguous pairs are blocked, and released examples remain linked.");
