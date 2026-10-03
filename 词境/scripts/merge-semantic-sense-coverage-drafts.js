"use strict";

// Merge independent generator partitions. A partition may contain a frozen copy
// of the baseline, but a word may only be newly authored by its own partition.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const draftPath = path.join(root, "data", "semantic-sense-coverage-drafts.js");
const partitionDir = path.join(root, "data");

function readAssignment(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = "window.SEMANTIC_SENSE_COVERAGE_DRAFTS =";
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`${file} does not define drafts`);
  return JSON.parse(raw.slice(at + marker.length).trim().replace(/;$/, "")).entries || {};
}

function signature(entry) {
  return JSON.stringify(entry);
}

function main() {
  const baseline = readAssignment(draftPath);
  const partitions = fs.readdirSync(partitionDir)
    .filter((name) => /^semantic-sense-coverage-partition-[0-9]+\.js$/.test(name))
    .sort();
  const merged = { ...baseline };
  let additions = 0;
  for (const name of partitions) {
    for (const [word, entry] of Object.entries(readAssignment(path.join(partitionDir, name)))) {
      if (merged[word] && signature(merged[word]) !== signature(entry)) {
        // Baseline entries are copied into every partition. A different entry is
        // allowed only if the baseline did not contain the word at partition start.
        if (baseline[word]) continue;
      }
      if (!merged[word]) additions += 1;
      merged[word] = entry;
    }
  }
  fs.writeFileSync(draftPath, `window.SEMANTIC_SENSE_COVERAGE_DRAFTS = ${JSON.stringify({ entries: merged })};\n`, "utf8");
  console.log(JSON.stringify({ baselineWords: Object.keys(baseline).length, partitions: partitions.length, additions, mergedWords: Object.keys(merged).length }));
}

main();
