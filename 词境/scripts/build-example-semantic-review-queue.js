"use strict";

// Snapshot all book words, including those excluded from generation. Never
// modify a running worker's files or count generator acceptance as a review.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { composeEntry } = require("./compose-semantic-sense-coverage");
const root = path.resolve(__dirname, "..");
function readAssignment(relative, name) {
  const raw = fs.readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`missing assignment: ${relative}`);
  return JSON.parse(raw.slice(at + marker.length).trim().replace(/;$/, ""));
}
function snapshot() {
  const book = JSON.parse(fs.readFileSync(path.join(root, "public/bundled-imports/27-one.json"), "utf8"));
  const words = [...new Set(book.words.map((word) => String(word).toLowerCase()))];
  if (words.length !== 5487) throw new Error("unexpected target word count");
  const published = readAssignment("data/context-resolved-examples.js", "WORD_AI_EXAMPLE_LIBRARY").entries;
  const dictionary = readAssignment("public/word-senses.js", "WORD_SENSE_LIBRARY").entries;
  const plan = JSON.parse(fs.readFileSync(path.join(root, "data/semantic-sense-coverage-plan.json"), "utf8")).entries;
  const corrections = JSON.parse(fs.readFileSync(path.join(root, "content/semantic-reviewed-corrections.json"), "utf8"));
  const baseline = readAssignment("data/semantic-sense-coverage-drafts.js", "SEMANTIC_SENSE_COVERAGE_DRAFTS").entries;
  const drafts = { ...baseline };
  // Match the merge script: baseline wins over frozen partition copies.
  for (let index = 0; index < 8; index += 1) {
    const relative = `data/semantic-sense-coverage-partition-${index}.js`;
    if (!fs.existsSync(path.join(root, relative))) continue;
    const partition = readAssignment(relative, "SEMANTIC_SENSE_COVERAGE_DRAFTS").entries;
    for (const [word, entry] of Object.entries(partition)) {
      if (!baseline[word]) drafts[word] = entry;
    }
  }
  const entries = {};
  const counts = { totalWords: words.length, reviewedCorrections: 0, awaitingGeneration: 0, awaitingSemanticReview: 0, invalidCandidates: 0 };
  for (const word of words) {
    let candidate = published[word];
    let source = "published-retained";
    let error = null;
    let status = "awaiting-semantic-review";
    if (plan[word]) {
      if (plan[word].requestedCount > 0 && !drafts[word]) {
        status = "awaiting-generation";
      } else {
        try {
          candidate = composeEntry(word, plan[word], drafts[word] || { examples: [], omittedSenseIds: [] });
          source = "generated-and-retained";
        } catch (failure) {
          status = "invalid-candidate";
          error = failure.message;
        }
      }
    }
    if (corrections.entries[word]) {
      if (!corrections.reviews[word]?.source) throw new Error(`missing review evidence: ${word}`);
      candidate = corrections.entries[word];
      source = "reviewed-correction";
      status = "reviewed-correction";
      error = null;
    }
    if (!candidate) {
      status = "invalid-candidate";
      error = "missing candidate";
    }
    const key = { "reviewed-correction": "reviewedCorrections", "awaiting-generation": "awaitingGeneration", "awaiting-semantic-review": "awaitingSemanticReview", "invalid-candidate": "invalidCandidates" }[status];
    counts[key] += 1;
    entries[word] = {
      status, source, error,
      fingerprint: crypto.createHash("sha256").update(JSON.stringify(candidate || null)).digest("hex"),
      dictionarySenses: dictionary[word]?.senses || [],
      omittedForCap: plan[word]?.omittedForCap || [],
      omittedSenseIds: drafts[word]?.omittedSenseIds || [],
      review: corrections.reviews[word] || null,
      candidate
    };
  }
  return { generatedAt: new Date().toISOString(), scope: "Review queue only. Generated candidates have not passed semantic review.", counts, entries };
}
function main() {
  const report = snapshot();
  const output = path.join(root, "data/example-semantic-review-queue.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...report.counts, output }));
}
if (require.main === module) main();
module.exports = { snapshot };
