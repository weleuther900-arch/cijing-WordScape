"use strict";

// This module deliberately has no network knowledge.  It prepares a compact,
// encrypted snapshot and deterministically merges two device states.  Keeping
// it separate makes the data rules testable without a browser or a Worker.
(function attachWordscapeSync(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WORDSCAPE_SYNC = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeWordscapeSync() {
  const SYNC_FORMAT = "wordscape-sync-v1";
  const SALT = "wordscape-sync-key-v1";
  const KEY_CACHE = new Map();

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function isoTime(value) { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : 0; }
  function newer(left, right, ...fields) {
    const leftTime = Math.max(...fields.map((field) => isoTime(left?.[field])));
    const rightTime = Math.max(...fields.map((field) => isoTime(right?.[field])));
    return rightTime > leftTime ? right : left;
  }
  function uniqueBy(items, key) {
    const seen = new Map();
    (items || []).forEach((item) => { if (item) seen.set(key(item), item); });
    return [...seen.values()];
  }
  function normalText(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function notebookKey(notebook) { return normalText(notebook?.name) || String(notebook?.id || ""); }
  function wordKey(word, notebookId) { return `${notebookId || word?.notebookId || ""}|${normalText(word?.text)}`; }
  function activityTime(word) { return Math.max(isoTime(word?.lastReviewAt), isoTime(word?.learnedAt), isoTime(word?.updatedAt), isoTime(word?.createdAt)); }
  function resetTime(state) { return isoTime(state?.learningResetAt); }
  function clearWordProgress(word) {
    Object.assign(word, { learningSeen: false, learningPlanDate: null, learnedAt: null, stage: "learning", dueAt: null, stability: null, difficulty: null, lastReviewAt: null, reviewCount: 0, lapses: 0, contexts: [] });
    ["lastSenseAttempt", "masteredCycles", "masterySeenSceneIds", "masteryCheckDueAt"].forEach((field) => delete word[field]);
  }
  function applyLearningReset(state, resetAt) {
    (state.words || []).forEach(clearWordProgress);
    state.logs = [];
    (state.batches || []).forEach((batch) => { batch.status = "learning"; });
    state.learningResetAt = resetAt;
    return state;
  }
  function mergeContexts(left, right) {
    return uniqueBy([...(left || []), ...(right || [])], (item) => `${item.sceneId || ""}|${item.senseId || ""}|${item.usedAt || ""}`)
      .sort((a, b) => isoTime(a.usedAt) - isoTime(b.usedAt));
  }
  function mergeMemoryTable(left, right) {
    const local = left && typeof left === "object" ? left : null;
    const remote = right && typeof right === "object" ? right : null;
    if (!local) return remote ? clone(remote) : null;
    if (!remote) return clone(local);
    const latest = isoTime(remote.updatedAt) > isoTime(local.updatedAt) ? remote : local;
    const merged = { ...clone(latest) };
    const visibility = isoTime(remote.definitionUpdatedAt) > isoTime(local.definitionUpdatedAt) ? remote : local;
    if (visibility.definitionUpdatedAt || local.definitionHidden !== undefined || remote.definitionHidden !== undefined || local.definitionVisible !== undefined || remote.definitionVisible !== undefined) {
      merged.definitionHidden = Boolean(visibility.definitionHidden);
      if ("definitionVisible" in visibility) merged.definitionVisible = Boolean(visibility.definitionVisible);
      else delete merged.definitionVisible;
      merged.definitionUpdatedAt = visibility.definitionUpdatedAt || local.definitionUpdatedAt || remote.definitionUpdatedAt || null;
    }
    const hideModes = [["hideReciteDefinitions", "hideReciteDefinitionsUpdatedAt"], ["hideDictationDefinitions", "hideDictationDefinitionsUpdatedAt"]];
    hideModes.forEach(([field, updatedAt]) => {
      const hasValue = field in local || field in remote || "hideAll" in local || "hideAll" in remote;
      if (!hasValue) return;
      const localTime = isoTime(local[updatedAt] || local.updatedAt); const remoteTime = isoTime(remote[updatedAt] || remote.updatedAt);
      const source = remoteTime > localTime ? remote : local;
      merged[field] = Boolean(source[field] ?? source.hideAll);
      merged[updatedAt] = source[updatedAt] || source.updatedAt || local[updatedAt] || remote[updatedAt] || null;
    });
    const definitionModes = ["recite", "dictation"]; const definitionHiddenByMode = {}; const definitionUpdatedAtByMode = {}; let hasDefinitionModes = false;
    definitionModes.forEach((mode) => {
      const hasValue = local.definitionHiddenByMode?.[mode] !== undefined || remote.definitionHiddenByMode?.[mode] !== undefined || local.definitionHidden !== undefined || remote.definitionHidden !== undefined;
      if (!hasValue) return;
      hasDefinitionModes = true;
      const localUpdatedAt = local.definitionUpdatedAtByMode?.[mode] || local.definitionUpdatedAt; const remoteUpdatedAt = remote.definitionUpdatedAtByMode?.[mode] || remote.definitionUpdatedAt;
      const source = isoTime(remoteUpdatedAt) > isoTime(localUpdatedAt) ? remote : local;
      definitionHiddenByMode[mode] = Boolean(source.definitionHiddenByMode?.[mode] ?? source.definitionHidden);
      definitionUpdatedAtByMode[mode] = source.definitionUpdatedAtByMode?.[mode] || source.definitionUpdatedAt || localUpdatedAt || remoteUpdatedAt || null;
    });
    if (hasDefinitionModes) { merged.definitionHiddenByMode = definitionHiddenByMode; merged.definitionUpdatedAtByMode = definitionUpdatedAtByMode; }
    const steps = {};
    const ids = new Set([...Object.keys(local.steps || {}), ...Object.keys(remote.steps || {})]);
    ids.forEach((id) => {
      const leftStep = local.steps?.[id]; const rightStep = remote.steps?.[id];
      if (!leftStep) { steps[id] = clone(rightStep); return; }
      if (!rightStep) { steps[id] = clone(leftStep); return; }
      steps[id] = clone(isoTime(rightStep.updatedAt) > isoTime(leftStep.updatedAt) ? rightStep : leftStep);
    });
    if (ids.size) merged.steps = steps;
    return merged;
  }
  function mergeNotebook(left, right) {
    const chosen = newer(left, right, "updatedAt", "archivedAt", "createdAt");
    const merged = { ...clone(chosen) };
    const memoryTable = mergeMemoryTable(left?.memoryTable, right?.memoryTable);
    if (memoryTable) merged.memoryTable = memoryTable;
    return merged;
  }
  function mergeWord(left, right) {
    if (!left) return clone(right);
    if (!right) return clone(left);
    const chosen = activityTime(right) > activityTime(left) ? right : left;
    const other = chosen === left ? right : left;
    const merged = { ...clone(other), ...clone(chosen) };
    const memoryTable = mergeMemoryTable(left.memoryTable, right.memoryTable);
    if (memoryTable) merged.memoryTable = memoryTable;
    merged.learningSeen = Boolean(left.learningSeen || right.learningSeen);
    merged.contexts = mergeContexts(left.contexts, right.contexts);
    merged.masterySeenSceneIds = [...new Set([...(left.masterySeenSceneIds || []), ...(right.masterySeenSceneIds || [])])];
    merged.reviewCount = Math.max(Number(left.reviewCount) || 0, Number(right.reviewCount) || 0);
    merged.lapses = Math.max(Number(left.lapses) || 0, Number(right.lapses) || 0);
    merged.createdAt = [left.createdAt, right.createdAt].filter(Boolean).sort()[0] || merged.createdAt;
    return merged;
  }
  function compactState(state) {
    const output = clone(state || {});
    output.version = Math.max(2, Number(output.version) || 1);
    output.words = (output.words || []).map((word) => {
      const item = { ...word };
      // Bundled entries are rebuilt from static assets after download. Keep
      // definitions only for custom terms, so D1 stores progress—not a second
      // copy of the 5,000-word dictionary.
      item.contexts = item.contexts || [];
      return item;
    });
    output.logs = output.logs || [];
    // The secret must never be placed in an otherwise portable snapshot.
    if (output.sync) output.sync = { revision: Number(output.sync.revision) || 0, lastSyncedAt: output.sync.lastSyncedAt || null };
    return output;
  }
  function mergeState(localState, remoteState) {
    const local = clone(localState || {});
    const remote = clone(remoteState || {});
    const localResetAt = resetTime(local);
    const remoteResetAt = resetTime(remote);
    if (remoteResetAt > localResetAt) applyLearningReset(local, remote.learningResetAt);
    if (localResetAt > remoteResetAt) applyLearningReset(remote, local.learningResetAt);
    const latestResetAt = remoteResetAt > localResetAt ? remote.learningResetAt : localResetAt > remoteResetAt ? local.learningResetAt : local.learningResetAt || remote.learningResetAt || null;
    const notebookByKey = new Map();
    const notebookIdMap = new Map();
    [...(local.notebooks || []), ...(remote.notebooks || [])].forEach((notebook) => {
      const key = notebookKey(notebook);
      const prior = notebookByKey.get(key);
      if (!prior) { notebookByKey.set(key, clone(notebook)); notebookIdMap.set(notebook.id, notebook.id); return; }
      const chosen = mergeNotebook(prior, notebook);
      notebookByKey.set(key, clone(chosen));
      notebookIdMap.set(notebook.id, chosen.id);
      notebookIdMap.set(prior.id, chosen.id);
    });
    const notebooks = [...notebookByKey.values()];
    const localWordIds = new Map();
    const wordByKey = new Map();
    (local.words || []).forEach((word) => {
      const normalized = { ...clone(word), notebookId: notebookIdMap.get(word.notebookId) || word.notebookId };
      wordByKey.set(wordKey(normalized), normalized);
      localWordIds.set(word.id, normalized.id);
    });
    const remoteWordIds = new Map();
    (remote.words || []).forEach((word) => {
      const normalized = { ...clone(word), notebookId: notebookIdMap.get(word.notebookId) || word.notebookId };
      const key = wordKey(normalized);
      const prior = wordByKey.get(key);
      const merged = mergeWord(prior, normalized);
      wordByKey.set(key, merged);
      remoteWordIds.set(word.id, merged.id);
      if (prior) localWordIds.set(prior.id, merged.id);
    });
    const words = [...wordByKey.values()];
    const remapWord = (wordId, source) => (source === "remote" ? remoteWordIds.get(wordId) : localWordIds.get(wordId)) || wordId;
    const logByKey = new Map();
    const addLogs = (logs, source) => (logs || []).forEach((log) => {
      const item = { ...clone(log), wordId: remapWord(log.wordId, source) };
      const key = item.id || `${item.wordId}|${item.reviewedAt || ""}|${item.grade || ""}`;
      const prior = logByKey.get(key);
      logByKey.set(key, prior ? newer(prior, item, "reviewedAt", "nextDueAt") : item);
    });
    addLogs(local.logs, "local"); addLogs(remote.logs, "remote");
    const batchByKey = new Map();
    const addBatches = (batches, source) => (batches || []).forEach((batch) => {
      const item = { ...clone(batch), notebookId: notebookIdMap.get(batch.notebookId) || batch.notebookId, wordIds: (batch.wordIds || []).map((wordId) => remapWord(wordId, source)) };
      const key = `${item.notebookId || ""}|${item.source || ""}|${item.createdAt || item.id}`;
      const prior = batchByKey.get(key);
      batchByKey.set(key, prior ? { ...newer(prior, item, "updatedAt", "createdAt"), wordIds: [...new Set([...(prior.wordIds || []), ...(item.wordIds || [])])] } : item);
    });
    addBatches(local.batches, "local"); addBatches(remote.batches, "remote");
    const newerState = newer(local, remote, "updatedAt");
    const merged = { ...clone(newerState), version: Math.max(2, Number(local.version) || 1, Number(remote.version) || 1), notebooks, words, batches: [...batchByKey.values()], logs: [...logByKey.values()].sort((a, b) => isoTime(a.reviewedAt) - isoTime(b.reviewedAt)), updatedAt: new Date().toISOString() };
    if (latestResetAt) merged.learningResetAt = latestResetAt;
    const requestedActive = notebookIdMap.get(newerState.activeNotebookId) || newerState.activeNotebookId;
    merged.activeNotebookId = notebooks.some((notebook) => notebook.id === requestedActive && !notebook.archivedAt) ? requestedActive : notebooks.find((notebook) => !notebook.archivedAt)?.id || notebooks[0]?.id || null;
    return merged;
  }
  function toBase64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    // Avoid repeatedly extending one very large string.  Safari can become
    // extremely slow when a multi-megabyte encrypted snapshot is converted at
    // once; a compact stream of small chunks is both faster and lighter.
    let value = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) value += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    return btoa(value);
  }
  function fromBase64(value) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }
  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function keyFor(secret) {
    const cached = KEY_CACHE.get(secret);
    if (cached) return cached;
    const task = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"])
      .then((material) => crypto.subtle.deriveKey({ name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: 150000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    KEY_CACHE.set(secret, task);
    task.catch(() => { if (KEY_CACHE.get(secret) === task) KEY_CACHE.delete(secret); });
    return task;
  }
  async function readStream(stream) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function compress(bytes) {
    if (typeof CompressionStream === "undefined") return { bytes, compression: "none" };
    return { bytes: await readStream(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))), compression: "gzip" };
  }
  async function decompress(bytes, compression) {
    if (!compression || compression === "none") return bytes;
    if (compression !== "gzip" || typeof DecompressionStream === "undefined") throw new Error("此设备无法读取加密同步内容，请更新 Safari 后重试");
    return readStream(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")));
  }
  async function encrypt(state, secret) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const source = new TextEncoder().encode(JSON.stringify({ format: SYNC_FORMAT, state: compactState(state) }));
    const { bytes: plaintext, compression } = await compress(source);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), plaintext);
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)), compression };
  }
  async function decrypt(payload, secret) {
    if (!payload?.iv || !payload?.ciphertext) throw new Error("云端数据格式无效");
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(payload.iv) }, await keyFor(secret), fromBase64(payload.ciphertext)));
    const value = JSON.parse(new TextDecoder().decode(await decompress(plaintext, payload.compression)));
    if (value?.format !== SYNC_FORMAT || !value?.state) throw new Error("同步密钥不正确或云端数据已损坏");
    return value.state;
  }
  function createSecret() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("").replace(/(.{6})/g, "$1-").replace(/-$/, "");
  }
  return { SYNC_FORMAT, compactState, mergeState, sha256, encrypt, decrypt, createSecret };
});
