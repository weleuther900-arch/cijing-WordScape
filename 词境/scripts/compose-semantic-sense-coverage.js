"use strict";

// Materialise the staged, validated sense drafts only when every requested word
// has been produced. This prevents a partial batch from reaching public assets.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const currentPath = path.join(root, "data", "context-resolved-examples.js");
const planPath = path.join(root, "data", "semantic-sense-coverage-plan.json");
const draftsPath = path.join(root, "data", "semantic-sense-coverage-drafts.js");
const correctionsPath = path.join(root, "content", "semantic-reviewed-corrections.json");

function readAssignment(file, name) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`${file} does not define ${name}`);
  return JSON.parse(raw.slice(at + marker.length).trim().replace(/;$/, ""));
}

function sameIds(left, right) {
  const a = [...new Set((left || []).map(String))].sort();
  const b = [...new Set((right || []).map(String))].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function composeEntry(word, plan, draft) {
  const omitted = new Set((draft?.omittedSenseIds || []).map(String));
  const generated = new Map((draft?.examples || []).map((example) => [String(example.senseId), example]));
  const targets = plan.targetSenses || [];
  const targetIds = new Set(targets.map((sense) => String(sense.id)));
  if ([...omitted].some((id) => !targetIds.has(id))) throw new Error(`${word}: unknown omitted sense`);
  if ([...generated].some(([id]) => !targetIds.has(id) || omitted.has(id))) throw new Error(`${word}: invalid generated sense`);
  if (generated.size + omitted.size !== targets.length) throw new Error(`${word}: incomplete target coverage`);

  const units = [];
  for (const sense of plan.retainedSenses || []) {
    const example = (plan.retainedExamples || []).find((item) => sameIds(item.sourceSenseIds, sense.sourceSenseIds));
    if (!example) throw new Error(`${word}: missing retained example for ${sense.id}`);
    units.push({ sense, example });
  }
  for (const sense of targets) {
    if (!omitted.has(String(sense.id))) units.push({ sense, example: generated.get(String(sense.id)) });
  }
  if (!units.length || units.length > 5) throw new Error(`${word}: example cap violation`);
  return {
    senseGroups: units.map((unit, index) => ({
      id: `semantic-${index + 1}`,
      partOfSpeech: String(unit.sense.partOfSpeech || "").trim(),
      sourceSenseIds: (unit.sense.sourceSenseIds || []).map(String),
      sense: String(unit.sense.sense || "").trim(),
      contextReviewed: true,
      semanticDistinct: true
    })),
    examples: units.map((unit, index) => ({
      sentence: String(unit.example.sentence || "").trim(),
      translation: String(unit.example.translation || "").trim(),
      targetForm: String(unit.example.targetForm || "").trim(),
      senseId: `semantic-${index + 1}`
    }))
  };
}

function main() {
  const current = readAssignment(currentPath, "WORD_AI_EXAMPLE_LIBRARY");
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const drafts = readAssignment(draftsPath, "SEMANTIC_SENSE_COVERAGE_DRAFTS").entries || {};
  const entries = { ...(current.entries || {}) };
  let rebuilt = 0;
  for (const [word, item] of Object.entries(plan.entries || {})) {
    if (item.requestedCount > 0 && !drafts[word]) throw new Error(`missing draft: ${word}`);
    entries[word] = composeEntry(word, item, drafts[word] || { examples: [], omittedSenseIds: [] });
    rebuilt += 1;
  }
  const corrections = JSON.parse(fs.readFileSync(correctionsPath, "utf8"));
  for (const [word, entry] of Object.entries(corrections.entries)) {
    if (!entries[word]) throw new Error(`reviewed correction for unknown word: ${word}`);
    if (!corrections.reviews[word]?.source || !entry.examples?.length || entry.examples.length > 5) {
      throw new Error(`invalid reviewed correction: ${word}`);
    }
    entries[word] = entry;
  }
  const totalExamples = Object.values(entries).reduce((count, entry) => count + (entry.examples || []).length, 0);
  const output = {
    source: "dictionary-sense rebuild: semantically distinct learner-facing examples, maximum five per word",
    generatedAt: new Date().toISOString(),
    entries
  };
  fs.writeFileSync(currentPath, `window.WORD_AI_EXAMPLE_LIBRARY = ${JSON.stringify(output)};\n`, "utf8");
  console.log(JSON.stringify({ rebuiltWords: rebuilt, totalWords: Object.keys(entries).length, totalExamples }));
}

if (require.main === module) main();
module.exports = { composeEntry };
