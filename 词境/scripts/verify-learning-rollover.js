"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
const start = source.indexOf("function movePastLearningToReview()");
const end = source.indexOf("function showToast(message)", start);
assert.ok(start >= 0 && end > start, "Could not locate the learning rollover implementation.");

let today = "2026-08-16";
let gateClosed = false;
const words = Array.from({ length: 450 }, (_, index) => ({
  id: `word-${index + 1}`,
  stage: "learning",
  learningSeen: index < 150,
  learningPlanDate: index < 200 ? "2026-08-15" : null
}));
const state = { settings: { dailyNewTarget: 200 }, words };
const context = {
  state,
  beijingDateKey: () => today,
  wordsForBatch: () => words,
  studyWords: () => words,
  isReleasedForStudy: () => true,
  isGateClosed: () => gateClosed,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), context);

const firstPlan = context.dailyStudyWordsForBatch({ id: "batch" });
assert.equal(firstPlan.length, 200, "The next-day plan must remain capped at 200 words.");
assert.deepEqual(Array.from(firstPlan.slice(0, 50), (word) => word.id), Array.from({ length: 50 }, (_, index) => `word-${index + 151}`), "All 50 unseen words from yesterday must be carried into today first.");
assert.deepEqual(Array.from(firstPlan.slice(50), (word) => word.id), Array.from({ length: 150 }, (_, index) => `word-${index + 201}`), "The remaining 150 places must be filled with new words.");
assert.equal(words.filter((word) => word.stage === "review").length, 150, "Yesterday's 150 seen words must move to review.");
assert.equal(firstPlan.some((word) => Number(word.id.slice(5)) <= 150), false, "Yesterday's seen words must not remain on the learning page.");

// On the following day, only words not yet seen continue; seen words again
// leave learning for review, keeping the daily page at exactly 200 entries.
firstPlan.slice(0, 100).forEach((word) => { word.learningSeen = true; });
today = "2026-08-17";
const secondPlan = context.dailyStudyWordsForBatch({ id: "batch" });
assert.equal(secondPlan.length, 200, "Carry-over plus fresh words must still produce exactly 200 entries.");
assert.equal(words.filter((word) => word.stage === "review").length, 250, "Words seen on either previous day must be in review.");
assert.equal(secondPlan.some((word) => word.learningSeen), false, "No previously seen word may remain on the next day's learning page.");

console.log("Learning rollover verification passed: seen words move to review and unseen words fill the next fixed-size plan.");

const crossBatchWords = Array.from({ length: 220 }, (_, index) => ({ id: `cross-${index + 1}`, stage: "learning", learningSeen: false, learningPlanDate: null }));
const crossBatchContext = {
  state: { settings: { dailyNewTarget: 200 }, words: crossBatchWords },
  beijingDateKey: () => "2026-08-18",
  wordsForBatch: () => crossBatchWords.slice(0, 20),
  studyWords: () => crossBatchWords,
  isReleasedForStudy: () => true,
  isGateClosed: () => false,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), crossBatchContext);
assert.equal(crossBatchContext.dailyStudyWords().length, 200, "The daily plan must cover the whole active wordbook, not only the latest batch.");

const gatedWords = Array.from({ length: 20 }, (_, index) => ({ id: `gated-${index + 1}`, stage: "learning", learningSeen: false, learningPlanDate: null }));
const gatedContext = {
  state: { settings: { dailyNewTarget: 200 }, words: gatedWords },
  beijingDateKey: () => "2026-08-18",
  wordsForBatch: () => gatedWords,
  studyWords: () => gatedWords,
  isReleasedForStudy: () => true,
  isGateClosed: () => true,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), gatedContext);
assert.equal(gatedContext.dailyStudyWords().length, 0, "The review gate must block fresh words from entering a new daily plan.");

console.log("Daily planning verification passed: the plan spans the wordbook and honors the review gate.");