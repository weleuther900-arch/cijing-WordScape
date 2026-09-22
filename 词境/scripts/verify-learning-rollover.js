"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
const start = source.indexOf("function movePastLearningToReview()");
const end = source.indexOf("function showToast(message)", start);
assert.ok(start >= 0 && end > start, "Could not locate the learning rollover implementation.");

let today = "2026-09-22";
const words = Array.from({ length: 450 }, (_, index) => ({
  id: "word-" + (index + 1),
  stage: "learning",
  learningSeen: index < 150,
  learningPlanDate: index < 200 ? "2026-09-21" : null
}));
const state = { settings: { dailyNewTarget: 200 }, words };
const context = {
  state,
  beijingDateKey: () => today,
  wordsForBatch: () => words,
  studyWords: () => words,
  isReleasedForStudy: () => true,
  isGateClosed: () => false,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), context);

const firstPlan = context.dailyStudyWordsForBatch({ id: "batch" });
assert.equal(firstPlan.length, 200, "The daily new-word target must remain 200.");
assert.deepEqual(Array.from(firstPlan.slice(0, 50), (word) => word.id), Array.from({ length: 50 }, (_, index) => "word-" + (index + 151)), "Unseen carry-over words must stay first.");
assert.deepEqual(Array.from(firstPlan.slice(50), (word) => word.id), Array.from({ length: 150 }, (_, index) => "word-" + (index + 201)), "Untouched words must fill the remaining daily places.");
assert.equal(words.filter((word) => word.stage === "review").length, 150, "Yesterday's seen words must move to review.");

firstPlan.slice(0, 100).forEach((word) => { word.learningSeen = true; });
today = "2026-09-23";
const secondPlan = context.dailyStudyWordsForBatch({ id: "batch" });
assert.equal(secondPlan.length, 200, "Carry-over plus fresh words must keep the configured daily target.");
assert.equal(words.filter((word) => word.stage === "review").length, 250, "Words learned on either previous day must move to review.");
assert.equal(secondPlan.some((word) => word.learningSeen), false, "Previously learned words must not remain in the next day's learning list.");

const crossBatchWords = Array.from({ length: 220 }, (_, index) => ({ id: "cross-" + (index + 1), stage: "learning", learningSeen: false, learningPlanDate: null }));
const crossBatchContext = {
  state: { settings: { dailyNewTarget: 200 }, words: crossBatchWords },
  beijingDateKey: () => "2026-09-24",
  wordsForBatch: () => crossBatchWords.slice(0, 20),
  studyWords: () => crossBatchWords,
  isReleasedForStudy: () => true,
  isGateClosed: () => false,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), crossBatchContext);
assert.equal(crossBatchContext.dailyStudyWords().length, 200, "The daily plan must span the whole active wordbook.");

const backlogWords = Array.from({ length: 20 }, (_, index) => ({ id: "backlog-" + (index + 1), stage: "learning", learningSeen: false, learningPlanDate: null }));
const backlogContext = {
  state: { settings: { dailyNewTarget: 200 }, words: backlogWords },
  beijingDateKey: () => "2026-09-24",
  wordsForBatch: () => backlogWords,
  studyWords: () => backlogWords,
  isReleasedForStudy: () => true,
  isGateClosed: () => true,
  persist: () => Promise.resolve(),
  Date,
  console
};
vm.runInNewContext(source.slice(start, end), backlogContext);
assert.equal(backlogContext.dailyStudyWords().length, 20, "A large review backlog must never block untouched words from the learning page.");

console.log("Learning rollover verification passed: daily target retained and review backlog never blocks new-word learning.");
