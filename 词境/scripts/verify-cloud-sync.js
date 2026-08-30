"use strict";

const assert = require("node:assert/strict");
const sync = require("../public/sync-core.js");

(async () => {
  const base = { version: 2, settings: { dailyNewTarget: 10, darkMode: true }, notebooks: [{ id: "book-a", name: "27-One", createdAt: "2026-08-09T00:00:00.000Z" }], activeNotebookId: "book-a", batches: [{ id: "batch-a", notebookId: "book-a", source: "27-One", createdAt: "2026-08-09T00:00:00.000Z", wordIds: ["apple-a"] }], words: [{ id: "apple-a", notebookId: "book-a", text: "apple", definition: "a fruit", sentence: "An apple fell.", translation: "一个苹果掉了。", customNote: "keep me", createdAt: "2026-08-09T00:00:00.000Z", learningSeen: true, reviewCount: 1, contexts: [{ sceneId: "a", senseId: "sense-a", sentence: "An apple fell.", zh: "一个苹果掉了。", usedAt: "2026-08-09T01:00:00.000Z" }] }], logs: [{ id: "log-a", wordId: "apple-a", correct: true, responseTimeMs: 734, reviewedAt: "2026-08-09T01:00:00.000Z" }], appliedBundledImports: ["27-one"], sync: { enabled: true, key: "never-upload-this-key", revision: 4 }, updatedAt: "2026-08-09T01:00:00.000Z" };
  const secondDevice = { ...base, notebooks: [{ id: "book-b", name: "27-One", createdAt: "2026-08-09T00:00:00.000Z" }], activeNotebookId: "book-b", batches: [{ id: "batch-b", notebookId: "book-b", source: "27-One", createdAt: "2026-08-09T00:00:00.000Z", wordIds: ["apple-b", "banana-b"] }], words: [{ id: "apple-b", notebookId: "book-b", text: "apple", createdAt: "2026-08-09T00:00:00.000Z", lastReviewAt: "2026-08-09T02:00:00.000Z", reviewCount: 2, contexts: [{ sceneId: "b", usedAt: "2026-08-09T02:00:00.000Z" }] }, { id: "banana-b", notebookId: "book-b", text: "banana", createdAt: "2026-08-09T02:00:00.000Z", learningSeen: true }], logs: [{ id: "log-b", wordId: "apple-b", correct: true, reviewedAt: "2026-08-09T02:00:00.000Z" }], updatedAt: "2026-08-09T02:00:00.000Z" };
  const merged = sync.mergeState(base, secondDevice);
  const resetState = { ...base, learningResetAt: "2026-08-10T00:00:00.000Z", words: base.words.map((word) => ({ ...word, learningSeen: false, stage: "learning", contexts: [], reviewCount: 0 })), logs: [] };
  const resetMerged = sync.mergeState(secondDevice, resetState);
  assert.equal(resetMerged.logs.length, 0, "A newer global reset must remove older review logs from every device.");
  assert.equal(resetMerged.words.find((word) => word.text === "apple").learningSeen, false, "A newer global reset must remove older learning progress from every device.");
  assert.equal(resetMerged.learningResetAt, resetState.learningResetAt, "The latest reset timestamp must be retained.");
  assert.equal(merged.notebooks.length, 1, "同名词本应合并");
  assert.equal(merged.words.length, 2, "相同单词不应重复，新增单词应保留");
  assert.equal(merged.words.find((word) => word.text === "apple").contexts.length, 2, "两端例句使用记录应合并");
  assert.equal(merged.logs.length, 2, "两端复习日志应合并");
  const snapshot = sync.compactState(base);
  assert.equal(snapshot.words[0].definition, "a fruit", "Full word definitions must be synced.");
  assert.equal(snapshot.words[0].contexts[0].sentence, "An apple fell.", "Full learning contexts must be synced.");
  assert.equal(snapshot.logs[0].responseTimeMs, 734, "Full review log details must be synced.");
  assert.deepEqual(snapshot.appliedBundledImports, ["27-one"], "Import history must be synced.");
  assert.equal(snapshot.sync.key, undefined, "The sync secret must remain device-only.");
  const secret = "Demo-safe-sync-key-1234";
  const encrypted = await sync.encrypt(merged, secret);
  assert.notEqual(encrypted.ciphertext.includes("apple"), true, "密文中不应出现明文单词");
  const decrypted = await sync.decrypt(encrypted, secret);
  assert.equal(decrypted.words.find((word) => word.text === "apple").definition, "a fruit", "The encrypted round trip must preserve full word content.");
  assert.equal(decrypted.words.length, 2, "加密往返不得丢失学习记录");
  await assert.rejects(() => sync.decrypt(encrypted, "wrong-key-123456789"), "错误密钥必须无法解密");
  console.log("Cloud sync verification passed: merge, encryption, and wrong-key protection.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
