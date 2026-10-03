"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function readAssignment(file, name) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  return JSON.parse(raw.slice(raw.indexOf(marker) + marker.length).trim().replace(/;$/, ""));
}
function terms(sense) {
  return [...new Set(String(sense || "").replace(/[（(【\[].*?[）)】\]]/g, "").split(/[；;、，,／/]/)
    .map((term) => term.replace(/^(?:[a-z]+\.)\s*/i, "").replace(/[的地得]$/u, "").trim())
    .filter((term) => /[\u3400-\u9fff]/u.test(term)))];
}
function overlaps(left, right) {
  return left.some((term) => right.some((other) => term === other || term.includes(other) || other.includes(term)));
}

const library = readAssignment(path.join(root, "data", "context-resolved-examples.js"), "WORD_AI_EXAMPLE_LIBRARY");
const wordBook = JSON.parse(fs.readFileSync(path.join(root, "public", "bundled-imports", "27-one.json"), "utf8"));
const expectedWords = new Set(wordBook.words.map((word) => String(word).toLowerCase()));
assert.deepEqual(new Set(Object.keys(library.entries)), expectedWords, "The released examples must cover every bundled word.");
let examples = 0;
for (const [word, entry] of Object.entries(library.entries)) {
  const groups = new Map((entry.senseGroups || []).map((group) => [group.id, group]));
  const selected = [];
  assert.ok(entry.examples?.length, `${word} must retain at least one example.`);
  for (const example of entry.examples) {
    const group = groups.get(example.senseId);
    assert.ok(group?.contextReviewed && group?.semanticDistinct, `${word} example must use a reviewed distinct sense.`);
    assert.ok(!selected.some((previous) => overlaps(terms(previous.sense), terms(group.sense))), `${word} repeats a Chinese sense or near-equivalent sense.`);
    selected.push(group);
    examples += 1;
  }
}
const retail = library.entries.retail;
assert.deepEqual(retail.senseGroups.map((group) => group.sense), ["零售", "详述", "传播"], "retail must cover only distinct Chinese senses.");
console.log(`Distinct-sense verification passed: ${Object.keys(library.entries).length} words, ${examples} examples, no repeated learner-facing Chinese senses.`);
