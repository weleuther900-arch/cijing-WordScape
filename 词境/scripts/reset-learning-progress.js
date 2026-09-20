"use strict";

// Resets study progress while retaining notebooks, imported words, definitions,
// examples, and batches. It only writes when invoked with --confirm.
const fs = require("node:fs/promises");
const path = require("node:path");

const STATE_FILE = path.join(__dirname, "..", "data", "state.json");

function validState(value) {
  return value && typeof value === "object" && Array.isArray(value.words) &&
    Array.isArray(value.batches) && Array.isArray(value.logs);
}

function resetWordProgress(word) {
  const changed = Boolean(
    word.learningSeen || word.learningPlanDate || word.learnedAt || word.dueAt ||
    word.lastReviewAt || Number(word.reviewCount) || Number(word.lapses) ||
    Number(word.masteredCycles) || (Array.isArray(word.contexts) && word.contexts.length) ||
    word.lastSenseAttempt || word.stage !== "learning"
  );
  Object.assign(word, {
    learningSeen: false,
    learningPlanDate: null,
    learnedAt: null,
    stage: "learning",
    dueAt: null,
    stability: null,
    difficulty: null,
    lastReviewAt: null,
    reviewCount: 0,
    lapses: 0,
    contexts: []
  });
  ["lastSenseAttempt", "masteredCycles", "masterySeenSceneIds", "masteryCheckDueAt"].forEach((key) => delete word[key]);
  return changed;
}

async function main() {
  const state = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  if (!validState(state)) throw new Error("state.json 的结构无效，已停止重置。");

  const changedWords = state.words.filter(resetWordProgress).length;
  const removedLogs = state.logs.length;
  state.logs = [];
  state.batches.forEach((batch) => { batch.status = "learning"; });
  state.learningResetAt = new Date().toISOString();
  if (state.sync?.enabled) {
    state.sync.dirty = true;
    state.sync.contentVersion = Math.max(4, Number(state.sync.contentVersion) || 0);
  }
  state.updatedAt = new Date().toISOString();

  if (!process.argv.includes("--confirm")) {
    console.log(JSON.stringify({ preview: true, changedWords, removedLogs, retainedWords: state.words.length, retainedBatches: state.batches.length }, null, 2));
    console.log("不会写入。确认执行：node scripts/reset-learning-progress.js --confirm");
    return;
  }

  const temporary = `${STATE_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporary, STATE_FILE);
  console.log(JSON.stringify({ reset: true, changedWords, removedLogs, retainedWords: state.words.length, retainedBatches: state.batches.length }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
