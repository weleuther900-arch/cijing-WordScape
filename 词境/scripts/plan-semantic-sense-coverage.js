"use strict";

// Build a resumable plan for rebuilding learner-facing examples by true dictionary
// senses. A malformed historical group is never retained merely because it exists.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const currentPath = path.join(root, "data", "context-resolved-examples.js");
const sensesPath = path.join(root, "public", "word-senses.js");
const outputPath = path.join(root, "data", "semantic-sense-coverage-plan.json");

function readAssignment(file, name) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`${file} does not define ${name}`);
  return JSON.parse(raw.slice(at + marker.length).trim().replace(/;$/, ""));
}

function terms(sense) {
  return [...new Set(String(sense || "")
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .split(/[；;、，,／]/)
    .map((term) => term.replace(/^(?:[a-z]+\.)\s*/i, "").replace(/[的地得]$/u, "").trim())
    .filter((term) => /[\u3400-\u9fff]/u.test(term)))];
}

function sameMeaning(left, right) {
  const a = terms(left);
  const b = terms(right);
  return a.length > 0 && b.length > 0 && a.some((term) => b.some((other) => term === other || term.includes(other) || other.includes(term)));
}

function main() {
  const current = readAssignment(currentPath, "WORD_AI_EXAMPLE_LIBRARY").entries || {};
  const dictionary = readAssignment(sensesPath, "WORD_SENSE_LIBRARY").entries || {};
  const entries = {};
  let targetWords = 0;
  let targetSenses = 0;
  let overCapWords = 0;
  let retainedExamples = 0;
  let rejectedMergedExamples = 0;

  for (const [word, definition] of Object.entries(dictionary)) {
    const present = current[word] || { senseGroups: [], examples: [] };
    const sourceById = new Map((definition.senses || []).map((sense) => [String(sense.id), sense]));
    const candidates = [];
    for (const source of definition.senses || []) {
      const candidate = { id: String(source.id), partOfSpeech: String(source.partOfSpeech || ""), sense: String(source.sense || "") };
      if (!candidate.sense) continue;
      const equivalent = candidates.find((group) => sameMeaning(group.sense, candidate.sense));
      if (equivalent) equivalent.sourceSenseIds.push(candidate.id);
      else candidates.push({ ...candidate, sourceSenseIds: [candidate.id] });
    }
    const selected = candidates.slice(0, 5);
    if (candidates.length > 5) overCapWords += 1;

    const currentGroups = new Map((present.senseGroups || []).map((group) => [String(group.id), group]));
    const kept = [];
    for (const example of present.examples || []) {
      const group = currentGroups.get(String(example.senseId));
      const ids = Array.isArray(group?.sourceSenseIds) ? group.sourceSenseIds.map(String) : [];
      const sourceSenses = ids.map((id) => sourceById.get(id)).filter(Boolean);
      const isSingleMeaning = sourceSenses.length > 0 && sourceSenses.every((source) => sameMeaning(source.sense, sourceSenses[0].sense));
      const target = selected.find((candidate) => ids.length > 0 && ids.every((id) => candidate.sourceSenseIds.includes(id)));
      if (isSingleMeaning && target && !kept.some((item) => item.target.id === target.id)) kept.push({ example, target });
      else rejectedMergedExamples += 1;
    }
    retainedExamples += kept.length;
    const retainedIds = new Set(kept.map((item) => item.target.id));
    const targets = selected.filter((candidate) => !retainedIds.has(candidate.id));
    if (!targets.length && kept.length === selected.length) continue;
    targetWords += 1;
    targetSenses += targets.length;
    entries[word] = {
      retainedCount: kept.length,
      requestedCount: targets.length,
      retainedSenses: kept.map((item) => item.target),
      targetSenses: targets,
      retainedExamples: kept.map((item) => ({
        sentence: String(item.example.sentence || ""),
        translation: String(item.example.translation || ""),
        targetForm: String(item.example.targetForm || ""),
        sourceSenseIds: item.target.sourceSenseIds,
      })),
      omittedForCap: candidates.slice(5),
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    policy: "keep only verified single-meaning examples; rebuild all other dictionary senses; never exceed five examples per word",
    targetWords,
    targetSenses,
    overCapWords,
    retainedExamples,
    rejectedMergedExamples,
    entries,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ targetWords, targetSenses, overCapWords, retainedExamples, rejectedMergedExamples, output: path.relative(root, outputPath) }));
}

main();
