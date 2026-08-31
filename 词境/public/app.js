"use strict";

const FSRS6 = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
const DEFAULT_SETTINGS = { targetRetention: 0.92, reviewGate: 100, wordRate: 1.08, sentenceRate: 0.96, voiceSpeedVersion: 3, voiceURI: "", sentenceVoiceEngine: "natural", reducedMotion: false, darkMode: false, dailyNewTarget: 200, dailyReviewTarget: 30 };
const APP = document.querySelector("#app");
const TOAST = document.querySelector("#toast");
const SPEAKER_TEMPLATE = document.querySelector("#speaker-template");
const SPEAKER_ICON = SPEAKER_TEMPLATE.content.firstElementChild.innerHTML;
const CONTENT_LIBRARY = window.WORD_CONTENT_LIBRARY || {};
const EXAMPLE_LIBRARY = window.WORD_EXAMPLE_LIBRARY?.entries || {};
const EXAMPLE_LIBRARY_META = window.WORD_EXAMPLE_LIBRARY || {};
let SENSE_LIBRARY = window.WORD_SENSE_LIBRARY?.entries || {};
const SENSE_LIBRARY_VERSION = "20260815-08";
let senseLibraryLoading;
const AI_EXAMPLE_LIBRARY = { ...(window.WORD_AI_EXAMPLE_LIBRARY?.entries || {}) };
const AI_EXAMPLE_INDEX = window.WORD_AI_EXAMPLE_INDEX || {};
const RELEASED_EXAMPLE_WORDS = new Set((window.WORD_RELEASED_EXAMPLE_WORDS || []).map((word) => String(word).toLowerCase()));
const AI_EXAMPLE_LOADS = new Map();
const VERIFIED_EXAMPLE_REVISION = "20260821-02";
const SYNC = window.WORDSCAPE_SYNC;
// The desktop shortcut runs this app at 127.0.0.1, whereas iPhone and iPad
// open the Workers site.  Keep one explicit cloud endpoint so all three
// clients meet at the same encrypted profile instead of the desktop trying to
// call a non-existent local /api/sync route.
const CLOUD_SYNC_URL = "https://wordscape.weleuther900.workers.dev/api/sync";
const CLOUD_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CLOUD_SYNC_RETRY_MS = 5 * 60 * 1000;
const CLOUD_SYNC_INITIAL_DELAY_MS = 8000;
const CLOUD_SYNC_CONTENT_VERSION = 4;
const GENTLE_SAME_DAY_RECALL_LIMIT = 8;
const DEVICE_STATE_KEY = "wordscape-ios-state-v1";
const DEVICE_DATABASE_NAME = "wordscape-device-data";
const DEVICE_DATABASE_VERSION = 1;
const DEVICE_STORE_NAME = "state";
const DEVICE_RECORD_KEY = "current";
const DEVICE_CACHE_NAME = "wordscape-user-state-v1";
const DEVICE_CACHE_KEY = "/__wordscape-user-state__.json";
let storageMode = "server";
let browserDictionary;
let browserDictionaryLoading;
let importEntryOverride = null;
let deviceDatabasePromise;
let deviceStateLoadedFromLegacy = false;
let homeScreenRecoveryPending = false;
let homeScreenRecoveryError = "";
function isHomeScreenWebApp() { return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true); }
function hasStoredWords(value) { return Array.isArray(value?.words) && value.words.length > 0; }
function lastItem(items) { return items && items.length ? items[items.length - 1] : undefined; }
function cloneValue(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function apiFetch(url, options = {}) { return fetch(url, options); }
function readLegacyDeviceState() {
  try {
    const raw = localStorage.getItem(DEVICE_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function openDeviceDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("此浏览器不支持本机数据库"));
  if (!deviceDatabasePromise) {
    deviceDatabasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DEVICE_DATABASE_NAME, DEVICE_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DEVICE_STORE_NAME)) database.createObjectStore(DEVICE_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本机数据库"));
      request.onblocked = () => reject(new Error("本机数据库正被占用，请关闭其他词境页面后重试"));
    });
  }
  return deviceDatabasePromise;
}
function readDatabaseRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("读取本机数据失败"));
  });
}
function finishDatabaseTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("保存本机数据失败"));
    transaction.onabort = () => reject(transaction.error || new Error("保存本机数据失败"));
  });
}
async function loadCachedDeviceState() {
  if (!("caches" in window)) return null;
  const cache = await window.caches.open(DEVICE_CACHE_NAME);
  const response = await cache.match(DEVICE_CACHE_KEY);
  return response ? response.json() : null;
}
async function saveCachedDeviceState(value) {
  if (!("caches" in window)) return false;
  const cache = await window.caches.open(DEVICE_CACHE_NAME);
  await cache.put(DEVICE_CACHE_KEY, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
  return true;
}
function mostRecentSavedState(states) {
  return states.filter(Boolean).sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0] || null;
}
async function loadDeviceState() {
  const savedStates = [];
  try {
    const database = await openDeviceDatabase();
    const transaction = database.transaction(DEVICE_STORE_NAME, "readonly");
    const saved = await readDatabaseRequest(transaction.objectStore(DEVICE_STORE_NAME).get(DEVICE_RECORD_KEY));
    if (saved) savedStates.push(saved);
  } catch { /* Safari 不可用时，继续尝试离线文件缓存。 */ }
  try {
    const cached = await loadCachedDeviceState();
    if (cached) savedStates.push(cached);
  } catch { /* Safari 不可用时，继续尝试旧版小型存储。 */ }
  const recent = mostRecentSavedState(savedStates);
  if (recent) return recent;
  const legacyState = readLegacyDeviceState();
  if (legacyState) deviceStateLoadedFromLegacy = true;
  return legacyState;
}
const browserAssetLoads = new Map();
function loadBrowserAsset(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!browserAssetLoads.has(src)) {
    browserAssetLoads.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error("导入组件没有正确加载"));
      script.onerror = () => reject(new Error("导入组件下载失败，请检查网络后重试"));
      document.head.append(script);
    }));
  }
  return browserAssetLoads.get(src);
}
function loadSenseLibrary() {
  if (Object.keys(SENSE_LIBRARY).length) return Promise.resolve(SENSE_LIBRARY);
  if (!senseLibraryLoading) {
    senseLibraryLoading = loadBrowserAsset(`./word-senses.js?v=${SENSE_LIBRARY_VERSION}`, "WORD_SENSE_LIBRARY")
      .then((library) => {
        SENSE_LIBRARY = library?.entries || {};
        if (state && currentView) render();
        return SENSE_LIBRARY;
      })
      .catch(() => SENSE_LIBRARY);
  }
  return senseLibraryLoading;
}
function scheduleSenseLibraryLoad() {
  const start = () => { void loadSenseLibrary(); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 2500 });
  else window.setTimeout(start, 600);
}
function decodeXmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
}
function extractXlsxTextInBrowser(buffer) {
  if (!window.fflate?.unzipSync) throw new Error("Excel 导入组件没有正确加载");
  const archive = window.fflate.unzipSync(new Uint8Array(buffer));
  const readText = (name) => archive[name] ? new TextDecoder().decode(archive[name]) : "";
  const sharedStrings = [];
  for (const match of readText("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sharedStrings.push(decodeXmlText(match[1]));
  const values = [];
  for (const name of Object.keys(archive).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort()) {
    for (const cell of readText(name).matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const body = cell[2];
      const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1];
      const text = type === "s" ? sharedStrings[Number(value)] : decodeXmlText(inline || value);
      if (text) values.push(text);
    }
  }
  return values.join("\n");
}
async function extractFileOnDevice(file, extension) {
  if (extension === ".txt") return file.text();
  if (extension === ".docx") {
    const mammoth = await loadBrowserAsset("./vendor/mammoth.browser.min.js", "mammoth");
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (extension === ".xlsx" || extension === ".xlsm") {
    await loadBrowserAsset("./vendor/fflate.min.js", "fflate");
    return extractXlsxTextInBrowser(await file.arrayBuffer());
  }
  if (extension === ".pdf") {
    const pdfjs = await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", window.location.href).href;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    await task.destroy();
    return pages.join("\n");
  }
  if (extension === ".xls") throw new Error("旧版 .xls 请先在 Excel 或 Numbers 中另存为 .xlsx 后再导入");
  throw new Error("只支持 TXT、PDF、DOCX、XLSX 和 XLSM 文件");
}
async function saveDeviceState(value) {
  // Keep the complete user state on this device. Otherwise a device that has
  // pulled a cloud snapshot could later overwrite it with a trimmed version.
  let compact;
  try {
    // `structuredClone` was not available in some earlier iOS 15 releases.
    // Keep a JSON fallback so unsupported APIs cannot masquerade as a storage
    // permission problem.
    compact = typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  } catch {
    return false;
  }
  let saved = false;
  try {
    const database = await openDeviceDatabase();
    const transaction = database.transaction(DEVICE_STORE_NAME, "readwrite");
    transaction.objectStore(DEVICE_STORE_NAME).put(compact, DEVICE_RECORD_KEY);
    await finishDatabaseTransaction(transaction);
    saved = true;
  } catch { /* 同时尝试 Cache Storage，适配受限的 iOS 网页容器。 */ }
  try {
    saved = (await saveCachedDeviceState(compact)) || saved;
  } catch { /* 继续尝试旧版小型存储。 */ }
  if (saved) {
    try { localStorage.removeItem(DEVICE_STATE_KEY); } catch { /* 忽略旧版存储清理失败。 */ }
    deviceStateLoadedFromLegacy = false;
    return true;
  }
  try {
    localStorage.setItem(DEVICE_STATE_KEY, JSON.stringify(compact));
    return true;
  } catch {
    return false;
  }
}
async function requestPersistentDeviceStorage() {
  if (storageMode !== "device" || !navigator.storage?.persist) return;
  try { await navigator.storage.persist(); } catch { /* Storage persistence is best effort on iOS. */ }
}
function setCloudSyncStatus(message) {
  cloudSyncStatus = message;
  document.querySelectorAll("[data-cloud-sync-status]").forEach((element) => { element.textContent = message; });
}
function canUseCloudSync() {
  const config = state && syncConfig();
  return Boolean(SYNC && config?.enabled && config.key && window.crypto?.subtle);
}
function resetTimestamp(value) { const time = Date.parse(value || ""); return Number.isFinite(time) ? time : 0; }
function formatCloudSyncDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
function clearAllLearningProgress(resetAt) {
  (state.words || []).forEach((word) => {
    Object.assign(word, { learningSeen: false, learningPlanDate: null, learnedAt: null, stage: "learning", dueAt: null, stability: null, difficulty: null, lastReviewAt: null, reviewCount: 0, lapses: 0, contexts: [] });
    ["lastSenseAttempt", "masteredCycles", "masterySeenSceneIds", "masteryCheckDueAt"].forEach((field) => delete word[field]);
  });
  state.logs = [];
  (state.batches || []).forEach((batch) => { batch.status = "learning"; });
  state.learningResetAt = resetAt;
}
function applyCloudLearningReset(resetAt) {
  if (resetTimestamp(resetAt) <= resetTimestamp(state?.learningResetAt)) return false;
  clearAllLearningProgress(resetAt);
  question = null;
  reviewHistory = [];
  reviewHistoryIndex = null;
  pausedQuestion = null;
  return true;
}
function scheduleCloudSync() {
  clearTimeout(cloudSyncTimer);
  if (!canUseCloudSync()) return;
  if (cloudSyncRunning) { cloudSyncQueued = true; return; }
  setCloudSyncStatus("本地改动待同步 · 将在 4 小时内自动同步");
}
async function postCloudSync(body) {
  const response = await fetch(CLOUD_SYNC_URL, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "云端同步服务暂不可用");
  return payload;
}
function refreshCloudSyncState() {
  const voiceSpeedUpdated = upgradeVoiceSpeedSettings(state.settings);
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  if (voiceSpeedUpdated) syncConfig().dirty = true;
  migrateNotebookState();
  migrateMemoryTableState();
  // A cloud snapshot can contain thousands of words.  Their display data has
  // lightweight in-memory fallbacks, so do not walk and rewrite the entire
  // snapshot on iPhone before the first usable screen is available.
  if (storageMode !== "device") hydrateLocalContent();
  selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === state.activeNotebookId))?.id || null;
}
function cloudSyncIsDue() { return !resetTimestamp(state?.sync?.lastSyncedAt) || Date.now() - resetTimestamp(state.sync.lastSyncedAt) >= CLOUD_SYNC_INTERVAL_MS; }
function runScheduledCloudSync() {
  if (!canUseCloudSync()) return;
  if (document.hidden) { cloudSyncPollTimer = setTimeout(runScheduledCloudSync, CLOUD_SYNC_RETRY_MS); return; }
  void syncCloudState({ automatic: true });
}
function startCloudSyncPolling() {
  clearTimeout(cloudSyncPollTimer);
  if (!canUseCloudSync()) return;
  const lastSyncedAt = resetTimestamp(state.sync.lastSyncedAt);
  const delay = lastSyncedAt ? Math.max(1000, CLOUD_SYNC_INTERVAL_MS - (Date.now() - lastSyncedAt)) : CLOUD_SYNC_INITIAL_DELAY_MS;
  cloudSyncPollTimer = setTimeout(runScheduledCloudSync, delay);
}
async function syncCloudState({ manual = false, automatic = false } = {}) {
  if (!canUseCloudSync()) return false;
  if (cloudSyncRunning) { cloudSyncQueued = true; return false; }
  cloudSyncRunning = true;
  let config = syncConfig();
  const announced = Boolean(manual || automatic);
  if (announced) setCloudSyncStatus("正在同步…");
  try {
    const secret = config.key;
    const profileId = await SYNC.sha256(secret);
    const upload = async (revision, value) => postCloudSync({ action: "sync", profileId, revision, resetAt: value.learningResetAt || null, payload: await SYNC.encrypt(value, secret) });
    const remote = await postCloudSync({ action: "pull", profileId, revision: config.revision, lightweight: true });
    let appliedRemote = false;
    let needsUpload = Boolean(config.dirty);
    if (remote.status === "found" || remote.status === "current") {
      const remoteRevision = Number(remote.revision);
      if (!Number.isInteger(remoteRevision) || remoteRevision < 1) throw new Error("云端返回了无效版本");
      // A reset marker is deliberately outside the encrypted payload so it is
      // honored even when a stale device reports the same revision. This makes
      // a global "clear learning records" irreversible for older local state.
      if (applyCloudLearningReset(remote.resetAt)) {
        config = syncConfig();
        config.dirty = true;
        state.sync = config;
        appliedRemote = true;
        needsUpload = true;
      }
      if (remote.status === "found" && remoteRevision !== config.revision) {
        const remoteState = await SYNC.decrypt(remote.payload, secret);
        // A clean device simply accepts the current cloud snapshot.  A device
        // with local work merges it, then performs a guarded write below.
        state = config.dirty ? SYNC.mergeState(state, remoteState) : remoteState;
        config = { enabled: true, key: secret, revision: remoteRevision, lastSyncedAt: config.lastSyncedAt || null, dirty: Boolean(config.dirty), contentVersion: CLOUD_SYNC_CONTENT_VERSION };
        state.sync = config;
        refreshCloudSyncState();
        appliedRemote = true;
        needsUpload = Boolean(config.dirty);
      }
    } else if (remote.status === "missing") {
      config.revision = 0;
    } else {
      throw new Error("云端返回了未知同步状态");
    }
    let response = null;
    let uploaded = false;
    for (let attempt = 0; needsUpload && attempt < 3; attempt += 1) {
      response = await upload(config.revision, state);
      if (response.status === "saved" && Number.isFinite(Number(response.revision))) {
        config.revision = Number(response.revision);
        uploaded = true;
        break;
      }
      if (response.status !== "conflict" || !response.payload) throw new Error("云端未确认本次保存");
      if (applyCloudLearningReset(response.resetAt)) {
        config = syncConfig();
        config.dirty = true;
      }
      const remoteState = await SYNC.decrypt(response.payload, secret);
      config.revision = Number(response.revision) || 0;
      state = SYNC.mergeState(state, remoteState);
      state.sync = config;
      refreshCloudSyncState();
      appliedRemote = true;
    }
    if (needsUpload && (!response || response.status !== "saved" || !Number.isFinite(Number(response.revision)))) throw new Error("云端正在被另一台设备更新，请稍后重试");
    const completedWork = Boolean(manual || appliedRemote || uploaded);
    let releasedMemoryRows = false;
    if (completedWork) {
      config.enabled = true;
      config.key = secret;
      const changedDuringSync = cloudSyncQueued;
      config.dirty = changedDuringSync;
      config.contentVersion = CLOUD_SYNC_CONTENT_VERSION;
      config.lastSyncedAt = new Date().toISOString();
      state.sync = config;
      state.updatedAt = config.lastSyncedAt;
      await persist({ skipCloud: true, silent: true });
      setCloudSyncStatus(changedDuringSync ? "本地有新改动 · 将在下次自动同步时上传" : `已同步 · ${formatCloudSyncDate(config.lastSyncedAt)}（北京时间）`);
      startCloudSyncPolling();
      releasedMemoryRows = !changedDuringSync && releaseMemoryPendingDirectoryExits();
    }
    if (appliedRemote || releasedMemoryRows) {
      render();
      scheduleOfflineDictionaryHydration();
    }
    if (manual) showToast(appliedRemote ? "已从云端合并这台设备的学习记录。" : "三台设备的学习记录已同步。");
    return true;
  } catch (error) {
    const reason = error?.message || "网络或云端服务暂不可用";
    if (announced) setCloudSyncStatus(`同步失败：${reason}`);
    if (automatic) { clearTimeout(cloudSyncPollTimer); cloudSyncPollTimer = setTimeout(runScheduledCloudSync, CLOUD_SYNC_RETRY_MS); }
    if (manual) showToast(`同步未完成：${reason}`);
    return false;
  } finally {
    cloudSyncRunning = false;
    if (cloudSyncQueued) {
      cloudSyncQueued = false;
      syncConfig().dirty = true;
      setCloudSyncStatus("本地改动待同步 · 将在下次自动同步时上传");
    }
  }
}
async function enableCloudSync(secret) {
  const key = String(secret || "").trim();
  if (key.length < 16) { showToast("同步密钥至少需要 16 个字符。请生成或输入更长的密钥。"); return; }
  const prior = syncConfig();
  state.sync = { enabled: true, key, revision: prior.key === key ? prior.revision : 0, lastSyncedAt: prior.key === key ? prior.lastSyncedAt : null, dirty: true, contentVersion: CLOUD_SYNC_CONTENT_VERSION };
  await persist({ skipCloud: true, silent: true });
  render();
  setCloudSyncStatus("正在创建加密备份…");
  startCloudSyncPolling();
  showToast("云端同步已启用，正在创建这台设备的加密备份。" );
  void syncCloudState({ manual: true });
}
async function disableCloudSync() {
  if (!window.confirm("停止这台设备的云端同步？云端加密备份会保留，之后输入同一密钥即可重新连接。")) return;
  clearInterval(cloudSyncPollTimer);
  state.sync = { enabled: false, key: "", revision: 0, lastSyncedAt: null, dirty: false, contentVersion: CLOUD_SYNC_CONTENT_VERSION };
  setCloudSyncStatus("未启用");
  await persist({ skipCloud: true, silent: true });
  render();
  showToast("这台设备已停止云端同步，本机记录没有删除。");
}
async function recoverHomeScreenState(secret) {
  const key = String(secret || "").trim();
  if (key.length < 16) { homeScreenRecoveryError = "请输入浏览器中保存的完整同步密钥。"; render(); return; }
  if (!SYNC || !window.crypto?.subtle) { homeScreenRecoveryError = "这台设备不支持加密恢复。请改用设置中的备份文件恢复。"; render(); return; }
  homeScreenRecoveryError = "";
  showToast("正在恢复你的词本…");
  try {
    const profileId = await SYNC.sha256(key);
    const remote = await postCloudSync({ action: "pull", profileId, revision: 0 });
    if (remote.status !== "found" || !remote.payload) throw new Error("没有找到对应的加密备份。请先在浏览器版点“立即同步”。");
    const restored = await SYNC.decrypt(remote.payload, key);
    if (!restored || typeof restored !== "object" || !Array.isArray(restored.words)) throw new Error("加密备份格式无效。请重新在浏览器版同步一次。");
    state = restored;
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    state.sync = { enabled: true, key, revision: Math.max(0, Number(remote.revision) || 0), lastSyncedAt: new Date().toISOString(), dirty: false, contentVersion: CLOUD_SYNC_CONTENT_VERSION };
    syncConfig();
    refreshCloudSyncState();
    document.documentElement.dataset.reduceMotion = String(state.settings.reducedMotion);
    applyTheme();
    selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === state.activeNotebookId))?.id || null;
    homeScreenRecoveryPending = false;
    homeScreenRecoveryError = "";
    await persist({ skipCloud: true, silent: true });
    setCloudSyncStatus(`已恢复 · ${formatCloudSyncDate(state.sync.lastSyncedAt)}（北京时间）`);
    startCloudSyncPolling();
    render();
    scheduleOfflineDictionaryHydration();
    showToast("词本与学习记录已恢复到主屏幕版。" );
  } catch (error) {
    homeScreenRecoveryError = error?.message || "恢复失败，请检查网络和同步密钥后重试。";
    render();
  }
}
function dismissHomeScreenRecovery() {
  homeScreenRecoveryPending = false;
  state.settings.pwaRecoveryDismissed = true;
  void persist({ skipCloud: true, silent: true });
  render();
}
function openHomeScreenRecovery() {
  homeScreenRecoveryPending = true;
  homeScreenRecoveryError = "";
  currentView = "home";
  render();
}
async function copyCloudSyncKey() {
  const key = String(syncConfig().key || "");
  if (!key) { showToast("当前设备没有可复制的同步密钥。"); return; }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(key);
    showToast("同步密钥已复制。请仅粘贴到你自己的设备。");
  } catch {
    const field = document.querySelector("[data-cloud-sync-key]");
    field?.focus();
    field?.select();
    try {
      if (!document.execCommand?.("copy")) throw new Error("Copy command unavailable");
      showToast("同步密钥已复制。请仅粘贴到你自己的设备。");
    } catch {
      showToast("同步密钥已选中；请长按或使用系统复制。");
    }
  }
}
function dictionarySenses(definition) {
  return String(definition || "").replace(/\\n/g, "\n").replace(/\r/g, "").split("\n")
    .map((sense) => sense.trim().replace(/^(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.\s*/i, ""))
    .filter(Boolean).slice(0, 12);
}
function dictionaryPartOfSpeech(value, definition) {
  const rawTags = [
    ...String(value || "").split("/").map((entry) => entry.trim().match(/^[a-z]+/i)?.[0]).filter(Boolean),
    ...(String(definition || "").match(/\b(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\./gi) || []).map((tag) => tag.slice(0, -1))
  ];
  const aliases = { a: "adj", ad: "adv", vi: "v", vt: "v" };
  const tags = [...new Set(rawTags.map((tag) => aliases[tag.toLowerCase()] || tag.toLowerCase()))];
  return tags.length ? tags.map((tag) => `${tag}.`).join(" / ") : "词性未标注";
}
function dictionaryDefinitionEntries(definition, fallbackPartOfSpeech = "词性未标注") {
  const text = String(definition || "").replace(/\\n/g, "\n").replace(/\r/g, "");
  const entries = [];
  let activePartOfSpeech = fallbackPartOfSpeech || "词性未标注";
  const prefix = /^\s*((?:(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.\s*(?:\/|,|;|、)?\s*)+)(.*)$/i;
  text.split("\n").forEach((line) => {
    const value = line.trim();
    if (!value) return;
    const match = value.match(prefix);
    const partOfSpeech = match ? dictionaryPartOfSpeech(match[1], "") : activePartOfSpeech;
    const sense = (match ? match[2] : value).trim();
    if (!sense) return;
    activePartOfSpeech = partOfSpeech;
    if (!entries.some((entry) => entry.partOfSpeech === partOfSpeech && entry.sense === sense)) entries.push({ partOfSpeech, sense });
  });
  return entries;
}
function offlineDictionaryEntry(word, record) {
  const [phonetic, definition, partOfSpeech] = Array.isArray(record) ? record : [record?.phonetic, record?.definition, record?.partOfSpeech];
  const normalizedDefinition = String(definition || "").replace(/\\n/g, "\n");
  const resolvedPartOfSpeech = dictionaryPartOfSpeech(partOfSpeech, normalizedDefinition);
  const definitions = dictionaryDefinitionEntries(normalizedDefinition, resolvedPartOfSpeech);
  const senses = definitions.map((entry) => entry.sense);
  return { word, phonetic: String(phonetic || ""), definition: normalizedDefinition, partOfSpeech: definitions[0]?.partOfSpeech || resolvedPartOfSpeech, currentSense: senses[0] || "", senses, otherDefinitions: definitions.slice(1) };
}
async function loadBrowserDictionary() {
  if (browserDictionary) return browserDictionary;
  if (!browserDictionaryLoading) {
    browserDictionaryLoading = fetch("./offline-dictionary.json.gz", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok || !response.body) return { entries: {} };
        if (response.headers.get("content-encoding") === "gzip") return response.json();
        if ("DecompressionStream" in window) {
          const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
          return JSON.parse(await new Response(stream).text());
        }
        const fflate = await loadBrowserAsset("./vendor/fflate.min.js", "fflate");
        return JSON.parse(new TextDecoder().decode(fflate.gunzipSync(new Uint8Array(await response.arrayBuffer()))));
      })
      .then((payload) => new Map(Object.entries(payload.entries || {})))
      .catch(() => new Map());
  }
  browserDictionary = await browserDictionaryLoading;
  return browserDictionary;
}
const IMPORTED_WORD_DETAILS = {
  unit: { zh: "单位；单元；部件；组；单位的", partOfSpeech: "n. / adj.", currentSense: "单位；单元" },
  speech: { zh: "演讲；言语", partOfSpeech: "n.", currentSense: "演讲；言语" }, tile: { zh: "瓷砖；瓦片", partOfSpeech: "n.", currentSense: "瓷砖；瓦片" },
  dorm: { zh: "宿舍", partOfSpeech: "n.", currentSense: "宿舍" }, dictionary: { zh: "词典；字典", partOfSpeech: "n.", currentSense: "词典；字典" },
  screen: { zh: "屏幕；屏风；筛选", partOfSpeech: "n. / v.", currentSense: "屏幕" }, lover: { zh: "恋人；爱好者", partOfSpeech: "n.", currentSense: "恋人；爱好者" },
  shirt: { zh: "衬衫", partOfSpeech: "n.", currentSense: "衬衫" }, emphasize: { zh: "强调；着重", partOfSpeech: "v.", currentSense: "强调；着重" },
  pollution: { zh: "污染", partOfSpeech: "n.", currentSense: "污染" }, shepherd: { zh: "牧羊人；引导", partOfSpeech: "n. / v.", currentSense: "牧羊人" },
  foster: { zh: "培养；促进；寄养的", partOfSpeech: "v. / adj.", currentSense: "培养；促进" }, favorite: { zh: "最喜欢的；特别喜爱的人（或物）", partOfSpeech: "adj. / n.", currentSense: "最喜欢的" },
  technology: { zh: "技术；科技", partOfSpeech: "n.", currentSense: "技术；科技" }, wipe: { zh: "擦拭；清除", partOfSpeech: "v.", currentSense: "擦拭；清除" },
  scold: { zh: "责骂；训斥", partOfSpeech: "v.", currentSense: "责骂；训斥" }, dessert: { zh: "甜点；餐后甜食", partOfSpeech: "n.", currentSense: "甜点；餐后甜食" },
  outlet: { zh: "出口；插座；商店（销售点）", partOfSpeech: "n.", currentSense: "出口；插座；商店（销售点）" }, list: { zh: "清单；列出", partOfSpeech: "n. / v.", currentSense: "清单" },
  important: { zh: "重要的", partOfSpeech: "adj.", currentSense: "重要的" }, fatigue: { zh: "疲劳；使疲劳", partOfSpeech: "n. / v.", currentSense: "疲劳" },
  insure: { zh: "投保；确保", partOfSpeech: "v.", currentSense: "投保；确保" }, vicious: { zh: "凶恶的；恶性的", partOfSpeech: "adj.", currentSense: "凶恶的；恶性的" },
  tame: { zh: "驯服的；驯服", partOfSpeech: "adj. / v.", currentSense: "驯服的" }, vapour: { zh: "蒸气", partOfSpeech: "n.", currentSense: "蒸气" },
  fold: { zh: "折叠；褶痕", partOfSpeech: "v. / n.", currentSense: "折叠" }, rain: { zh: "雨；下雨", partOfSpeech: "n. / v.", currentSense: "雨" },
  monster: { zh: "怪物；巨兽", partOfSpeech: "n.", currentSense: "怪物；巨兽" }, injure: { zh: "使受伤；损害", partOfSpeech: "v.", currentSense: "使受伤；损害" },
  pass: { zh: "通过；经过；及格；通行证", partOfSpeech: "v. / n.", currentSense: "通过；经过" }, astonish: { zh: "使惊讶；使吃惊", partOfSpeech: "v.", currentSense: "使惊讶；使吃惊" },
  component: { zh: "组成部分；部件", partOfSpeech: "n.", currentSense: "组成部分；部件" }, tea: { zh: "茶", partOfSpeech: "n.", currentSense: "茶" },
  mountain: { zh: "山；山脉", partOfSpeech: "n.", currentSense: "山；山脉" }, small: { zh: "小的；少的", partOfSpeech: "adj.", currentSense: "小的" },
  isolate: { zh: "隔离；使孤立", partOfSpeech: "v.", currentSense: "隔离；使孤立" }, administer: { zh: "管理；施用", partOfSpeech: "v.", currentSense: "管理；施用" },
  trail: { zh: "小径；踪迹；拖着走", partOfSpeech: "n. / v.", currentSense: "小径；踪迹" }, hospital: { zh: "医院", partOfSpeech: "n.", currentSense: "医院" },
  elegant: { zh: "优雅的；精美的", partOfSpeech: "adj.", currentSense: "优雅的；精美的" }, conversation: { zh: "谈话；会话", partOfSpeech: "n.", currentSense: "谈话；会话" },
  interest: { zh: "兴趣；利息；使感兴趣", partOfSpeech: "n. / v.", currentSense: "兴趣" }, naughty: { zh: "淘气的；顽皮的", partOfSpeech: "adj.", currentSense: "淘气的；顽皮的" },
  trolley: { zh: "手推车；电车", partOfSpeech: "n.", currentSense: "手推车；电车" }, fork: { zh: "叉子；岔路；分叉", partOfSpeech: "n. / v.", currentSense: "叉子；岔路" },
  awake: { zh: "醒着的；醒来", partOfSpeech: "adj. / v.", currentSense: "醒着的" }, away: { zh: "离开；远离", partOfSpeech: "adv.", currentSense: "离开；远离" },
  banana: { zh: "香蕉", partOfSpeech: "n.", currentSense: "香蕉" }, unlikely: { zh: "不太可能的", partOfSpeech: "adj.", currentSense: "不太可能的" },
  temporary: { zh: "暂时的；临时的", partOfSpeech: "adj.", currentSense: "暂时的；临时的" }, advance: { zh: "前进；推进；进步；预付款", partOfSpeech: "v. / n.", currentSense: "前进；推进" },
  locality: { zh: "地区；地点", partOfSpeech: "n.", currentSense: "地区；地点" }
};

const LEXICON = {
  bank: { zh: "银行；银行服务", phonetic: "/bæŋk/", kind: "place", sentence: "Grandfather paid his utility bill with a bank app.", review: [["爷爷在手机银行缴纳水电费。", "Grandfather paid his utility bill with a ____ app."], ["艾拉去银行开了一个新账户。", "Ella opened a new account at the ____. "]] },
  bridge: { zh: "桥", phonetic: "/brɪdʒ/", kind: "place", sentence: "A small bridge carries us across the river.", review: [["孩子们走过河上的木桥。", "The children walked over the wooden ____."], ["雾里能看见一座连接两岸的桥。", "In the mist, a ____ joined the two sides of the river."]] },
  ticket: { zh: "票；车票", phonetic: "/ˈtɪkɪt/", kind: "object", sentence: "Mina kept her train ticket in a blue pocket.", review: [["出发前，他把车票放进了口袋。", "Before leaving, he put his ____ in his pocket."], ["检票员请每位乘客出示车票。", "The inspector asked every passenger to show a ____. "]] },
  book: { zh: "书", phonetic: "/bʊk/", kind: "object", sentence: "At night, Leo read a book by the window.", review: [["睡前，安打开了一本故事书。", "Before bed, Ann opened a story ____."], ["图书馆员把书放回书架。", "The librarian returned the ____ to its shelf."]] },
  market: { zh: "市场；集市", phonetic: "/ˈmɑːrkɪt/", kind: "place", sentence: "The market smelled of fruit and warm bread.", review: [["周六早晨，人们在市场挑选新鲜水果。", "On Saturday morning, people chose fresh fruit at the ____."], ["她从市场带回一束小花。", "She brought home a small bunch of flowers from the ____. "]] },
  station: { zh: "车站", phonetic: "/ˈsteɪʃn/", kind: "place", sentence: "We waited at the quiet station for the last train.", review: [["火车站的时钟刚好指向八点。", "The clock at the ____ showed exactly eight."], ["他们在车站门口互相道别。", "They said goodbye at the entrance to the ____. "]] },
  garden: { zh: "花园", phonetic: "/ˈɡɑːrdn/", kind: "place", sentence: "In the garden, rain rested on every leaf.", review: [["奶奶在花园里给玫瑰浇水。", "Grandma watered the roses in the ____."], ["午后的猫躺在花园的石头上。", "The afternoon cat lay on a stone in the ____. "]] },
  river: { zh: "河；河流", phonetic: "/ˈrɪvər/", kind: "place", sentence: "The river moved slowly under the evening sky.", review: [["小船沿着河流慢慢前进。", "The small boat moved slowly along the ____."], ["他们坐在河边，听水流的声音。", "They sat beside the ____ and listened to the water."]] },
  letter: { zh: "信；字母", phonetic: "/ˈletər/", kind: "object", sentence: "A letter from home waited on the table.", review: [["她收到一封来自远方朋友的信。", "She received a ____ from a friend far away."], ["爸爸把信投进街角的邮筒。", "Dad put the ____ into the mailbox on the corner."]] },
  quiet: { zh: "安静的", phonetic: "/ˈkwaɪət/", kind: "adjective", sentence: "The library became quiet after the rain.", review: [["老师请大家在图书馆里保持安静。", "The teacher asked everyone to be ____ in the library."], ["清晨的街道很安静，只有鸟在叫。", "The street was ____ in the morning, with only birds singing."]] },
  bright: { zh: "明亮的", phonetic: "/braɪt/", kind: "adjective", sentence: "A bright lamp made the desk easy to see.", review: [["阳光很明亮，照进了厨房。", "The sun was ____ as it came into the kitchen."], ["她选了一盏明亮的灯来读书。", "She chose a ____ lamp for reading."]] },
  coffee: { zh: "咖啡", phonetic: "/ˈkɔːfi/", kind: "object", sentence: "A cup of coffee warmed his hands.", review: [["她在小咖啡馆点了一杯热咖啡。", "She ordered a hot cup of ____ at the small café."], ["桌上放着两杯咖啡。", "Two cups of ____ were on the table."]] },
  train: { zh: "火车", phonetic: "/treɪn/", kind: "object", sentence: "The train left just as the sky turned pink.", review: [["早班火车在六点离开站台。", "The early ____ left the platform at six."], ["他们从窗外看着火车穿过田野。", "They watched the ____ cross the fields from the window."]] },
  map: { zh: "地图", phonetic: "/mæp/", kind: "object", sentence: "The map showed a path beside the lake.", review: [["迷路后，他们打开地图找方向。", "After getting lost, they opened a ____ to find the way."], ["导游在地图上画了一条步行路线。", "The guide drew a walking route on the ____. "]] },
  bread: { zh: "面包", phonetic: "/bred/", kind: "object", sentence: "Fresh bread cooled beside the open window.", review: [["面包店刚烤好一条面包。", "The bakery had just baked a loaf of ____."], ["早餐时，她在面包上涂了黄油。", "At breakfast, she put butter on her ____. "]] },
  friend: { zh: "朋友", phonetic: "/frend/", kind: "person", sentence: "A friend saved a seat beside the door.", review: [["朋友在雨中等了他一会儿。", "A ____ waited for him in the rain."], ["她和朋友分享了一个好消息。", "She shared some good news with her ____. "]] },
  window: { zh: "窗；窗户", phonetic: "/ˈwɪndoʊ/", kind: "object", sentence: "The open window let in a cool breeze.", review: [["她轻轻打开窗户，让新鲜空气进来。", "She opened the ____ to let fresh air in."], ["一只鸟停在窗户外面的树枝上。", "A bird rested on a branch outside the ____. "]] },
  street: { zh: "街道", phonetic: "/striːt/", kind: "place", sentence: "The street shone after the evening rain.", review: [["孩子们在过马路前左右看。", "The children looked both ways before crossing the ____."], ["小店在一条安静的街道上。", "The small shop stood on a quiet ____. "]] },
  music: { zh: "音乐", phonetic: "/ˈmjuːzɪk/", kind: "object", sentence: "Soft music came from the room upstairs.", review: [["房间里传出轻柔的音乐。", "Soft ____ came from the room."], ["他们一边做饭一边听音乐。", "They listened to ____ while cooking."]] },
  morning: { zh: "早晨；上午", phonetic: "/ˈmɔːrnɪŋ/", kind: "time", sentence: "The morning began with pale light and tea.", review: [["早晨的第一缕阳光照在桌上。", "The first light of the ____ fell on the table."], ["他每天早晨都会散步。", "He takes a walk every ____. "]] }
};

let state;
let currentView = "home";
let selectedBatchId = null;
let question = null;
let learnPage = 0;
let revealedTranslations = new Set();
let reviewHistory = [];
let reviewHistoryIndex = null;
let pausedQuestion = null;
let toastTimer = null;
let saving = Promise.resolve();
let cloudSyncTimer = null;
let cloudSyncPollTimer = null;
let cloudSyncRunning = false;
let cloudSyncQueued = false;
let cloudSyncStatus = "未启用";
const LEARNING_PAGE_SIZE = 10;
const WORDS_PAGE_SIZE = 10;
let mistakePage = 0;
let savedPage = 0;
let librarySearch = "";
let savedWordsExpanded = false;
let masteredWordsExpanded = false;
let masteredPage = 0;
let historyCalendarMonth = null;
let wordbookPanelExpanded = false;
let learningPlanWordIds = new Set();
let learningPlanSeenCount = 0;
let learningPlanTotal = 0;
let deferredPersistTimer = null;
let deferredPersistOptions = null;
const MEMORY_STEPS = Object.freeze([
  { id: "first", label: "First", directory: "首日" },
  { id: "day1", label: "Day 1", directory: "一天" },
  { id: "day2", label: "Day 2", directory: "两天" },
  { id: "day4", label: "Day 4", directory: "四天" },
  { id: "day7", label: "Day 7", directory: "七天" },
  { id: "day15", label: "Day 15", directory: "十五" },
  { id: "day30", label: "Day 30", directory: "三十" }
]);
const MEMORY_TABLE_PAGE_SIZE = 80;
let memoryVisibleCount = MEMORY_TABLE_PAGE_SIZE;
let memorySearch = "";
const memoryRevealedDefinitions = new Map([["recite", new Set()], ["dictation", new Set()]]);
const memoryPendingDirectoryExits = new Map();
const DAILY_QUOTES = window.WORDSCAPE_DAILY_QUOTES || [
  ["Small deeds done are better than great deeds planned.", "完成微小的行动，胜过筹划宏大的目标。"],
  ["The future depends on what you do today.", "未来取决于你今天所做的事。"],
  ["A journey of a thousand miles begins with a single step.", "千里之行，始于足下。"],
  ["Little by little, a little becomes a lot.", "一点一滴，终会汇成丰盛。"],
  ["Well begun is half done.", "好的开始，是成功的一半。"],
  ["Patience is bitter, but its fruit is sweet.", "耐心虽苦，果实却甜。"],
  ["What we learn with pleasure, we never forget.", "愉悦中学到的东西，永远不会忘记。"]
];
const WORD_DETAILS = {
  due: { partOfSpeech: "adj. / prep.", currentSense: "到期的；预定的", senses: ["到期的；应付的", "预定发生的", "由于，因为（be due to）"] },
  alleviate: { partOfSpeech: "v.", currentSense: "减轻；缓和", senses: ["减轻（疼痛、压力等）", "缓和，缓解"] },
  weave: { partOfSpeech: "v.", currentSense: "编织", senses: ["编织", "交织", "编造（故事、谎言等）"] },
  drawing: { partOfSpeech: "n.", currentSense: "图画；素描", senses: ["图画；素描", "抽取；提款", "抽签"] },
  snow: { partOfSpeech: "n. / v.", currentSense: "雪；下雪", senses: ["雪", "下雪"] },
  realistic: { partOfSpeech: "adj.", currentSense: "逼真的；切合实际的", senses: ["现实的", "逼真的", "切合实际的"] },
  nevertheless: { partOfSpeech: "adv.", currentSense: "尽管如此；然而", senses: ["尽管如此", "不过；然而"] },
  ride: { partOfSpeech: "v. / n.", currentSense: "骑行；乘坐", senses: ["骑（车、马等）", "乘坐", "骑行；乘车"] },
  expression: { partOfSpeech: "n.", currentSense: "表情；表达", senses: ["表达；措辞", "表情", "数学表达式"] },
  spur: { partOfSpeech: "n. / v.", currentSense: "动力；激励", senses: ["刺激；动力", "马刺", "促进；激励"] },
  clutch: { partOfSpeech: "v. / n.", currentSense: "紧紧抓住", senses: ["紧握；抓住", "离合器", "一窝（蛋等）"] },
  pest: { partOfSpeech: "n.", currentSense: "害虫", senses: ["害虫", "讨厌的人或事物"] },
  standard: { partOfSpeech: "n. / adj.", currentSense: "标准；水准", senses: ["标准；水准", "标准的；合格的"] },
  compass: { partOfSpeech: "n. / v.", currentSense: "指南针", senses: ["指南针", "范围", "包围；环绕"] },
  gloomy: { partOfSpeech: "adj.", currentSense: "阴暗的；忧郁的", senses: ["阴暗的", "忧郁的", "令人沮丧的"] },
  fortunate: { partOfSpeech: "adj.", currentSense: "幸运的", senses: ["幸运的", "带来好运的"] },
  spectacular: { partOfSpeech: "adj.", currentSense: "壮观的；令人惊叹的", senses: ["壮观的", "令人惊叹的"] },
  nutrition: { partOfSpeech: "n.", currentSense: "营养；营养作用", senses: ["营养", "营养作用；营养摄入"] },
  anonymous: { partOfSpeech: "adj.", currentSense: "匿名的；无名的", senses: ["匿名的", "无名的"] },
  pat: { partOfSpeech: "v. / n.", currentSense: "轻拍；拍一拍", senses: ["轻拍", "轻拍声"] }
};
const WORD_USAGE_DETAILS = {
  due: { currentPartOfSpeech: "adj.", otherDefinitions: [{ partOfSpeech: "adj.", sense: "应付的；应得的" }, { partOfSpeech: "prep.", sense: "由于，因为（be due to）" }] },
  alleviate: { currentPartOfSpeech: "v.", otherDefinitions: [] },
  weave: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "v.", sense: "编造；把情节等编排在一起" }] },
  drawing: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "抽取；提款" }, { partOfSpeech: "n.", sense: "抽签" }] },
  snow: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "v.", sense: "下雪" }] },
  realistic: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  nevertheless: { currentPartOfSpeech: "adv.", otherDefinitions: [] },
  ride: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "骑行；乘车" }] },
  expression: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "表达；措辞" }, { partOfSpeech: "n.", sense: "数学表达式" }] },
  spur: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "马刺" }, { partOfSpeech: "v.", sense: "刺激；促进" }] },
  clutch: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "离合器" }, { partOfSpeech: "n.", sense: "一窝（蛋等）" }] },
  pest: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "讨厌的人或事物" }] },
  standard: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "adj.", sense: "标准的；合格的" }, { partOfSpeech: "n.", sense: "旗帜（正式或军事用语）" }] },
  compass: { currentPartOfSpeech: "n.", otherDefinitions: [{ partOfSpeech: "n.", sense: "范围" }, { partOfSpeech: "v.", sense: "包围；环绕" }] },
  gloomy: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  fortunate: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  spectacular: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  nutrition: { currentPartOfSpeech: "n.", otherDefinitions: [] },
  anonymous: { currentPartOfSpeech: "adj.", otherDefinitions: [] },
  pat: { currentPartOfSpeech: "v.", otherDefinitions: [{ partOfSpeech: "n.", sense: "轻拍；轻拍声" }] }
};
const REVIEW_CONTEXT_DETAILS = {
  due: [["adj.", "到期的；预定的"], ["adj.", "到期的；应付的"]], alleviate: [["v.", "减轻"], ["v.", "缓和"]],
  weave: [["v.", "编织"], ["v.", "交织"]], drawing: [["n.", "图画；素描"], ["n.", "图画；素描"]],
  snow: [["v.", "下雪"], ["n.", "雪"]], realistic: [["adj.", "逼真的"], ["adj.", "切合实际的"]],
  nevertheless: [["adv.", "然而；尽管如此"], ["adv.", "然而；尽管如此"]], ride: [["v.", "骑；骑行"], ["n.", "乘坐；骑行"]],
  expression: [["n.", "表情"], ["n.", "表达；措辞"]], spur: [["v.", "刺激；促进"], ["n.", "动力；刺激"]],
  clutch: [["v.", "紧紧抓住"], ["n.", "离合器"]], pest: [["n.", "害虫"], ["n.", "讨厌的人或事物"]],
  standard: [["n.", "标准；水准"], ["n.", "标准；水准"]], compass: [["n.", "指南针"], ["n.", "范围"]],
  gloomy: [["adj.", "阴暗的"], ["adj.", "忧郁的"]], fortunate: [["adj.", "幸运的"], ["adj.", "幸运的"]],
  spectacular: [["adj.", "壮观的；令人惊叹的"], ["adj.", "壮观的；令人惊叹的"]], nutrition: [["n.", "营养；营养作用"], ["n.", "营养；营养作用"]],
  anonymous: [["adj.", "匿名的；无名的"], ["adj.", "匿名的；无名的"]], pat: [["n.", "轻拍；拍一拍"], ["v.", "轻拍"]]
};

function syncConfig() {
  if (!state.sync || typeof state.sync !== "object") state.sync = {};
  state.sync.enabled = Boolean(state.sync.enabled && state.sync.key);
  state.sync.revision = Math.max(0, Number(state.sync.revision) || 0);
  state.sync.dirty = Boolean(state.sync.dirty);
  state.sync.contentVersion = Math.max(0, Number(state.sync.contentVersion) || 0);
  return state.sync;
}
function upgradeVoiceSpeedSettings(settings) {
  if (!settings || typeof settings !== "object" || Number(settings.voiceSpeedVersion) >= 3) return false;
  const version = Number(settings.voiceSpeedVersion) || 0;
  if (version < 2) {
    settings.wordRate = Math.max(1.08, Number(settings.wordRate) || 0);
    settings.sentenceRate = Math.max(1.14, Number(settings.sentenceRate) || 0);
  }
  if (version < 3) {
    if (!Number.isFinite(Number(settings.sentenceRate)) || Math.abs(Number(settings.sentenceRate) - 1.14) < 0.001) settings.sentenceRate = 0.96;
    if (settings.sentenceVoiceEngine !== "system" && settings.sentenceVoiceEngine !== "natural") settings.sentenceVoiceEngine = "natural";
  }
  settings.voiceSpeedVersion = 3;
  return true;
}
function makeInitialState() { return { version: 2, words: [], batches: [], logs: [], settings: { ...DEFAULT_SETTINGS }, sync: { enabled: false, key: "", revision: 0, lastSyncedAt: null, dirty: false, contentVersion: CLOUD_SYNC_CONTENT_VERSION }, updatedAt: new Date().toISOString() }; }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function now() { return new Date(); }
function daysBetween(from, to = now()) { return Math.max(0, (to - new Date(from)) / 86400000); }
function hoursFromNow(hours) { return new Date(Date.now() + hours * 3600000).toISOString(); }
function formatDue(iso) { if (!iso) return "待初学"; const ms = new Date(iso) - now(); if (ms <= 0) return "现在可复习"; const hours = Math.round(ms / 3600000); return hours < 24 ? `${hours} 小时后` : `${Math.round(hours / 24)} 天后`; }
function cardStatus(card) { if (card.stage === "learning") return ["待学习", "learning"]; if (card.stage === "sameDay") return ["待巩固", "learning"]; if (card.stage === "mastered") return ["已掌握", "review"]; return [formatDue(card.dueAt), "review"]; }
function wordData(word) {
  const key = word.text.toLowerCase();
  // The hand-checked starter cards always win. The attributed corpus adds
  // several offline examples to the remaining imported vocabulary.
  return { ...(LEXICON[key] || {}), ...(IMPORTED_WORD_DETAILS[key] || {}), ...(EXAMPLE_LIBRARY[key] || {}), ...(CONTENT_LIBRARY[key] || {}) };
}
function librarySenseEntries(word) {
  const key = String(word?.text || word || "").toLowerCase();
  return Array.isArray(SENSE_LIBRARY[key]?.senses) ? SENSE_LIBRARY[key].senses : [];
}
function aiRecordForWord(word) {
  const key = String(word?.text || word || "").toLowerCase();
  const record = AI_EXAMPLE_LIBRARY[key];
  return record && Array.isArray(record.examples) && Array.isArray(record.senseGroups) ? record : null;
}
function aiShardKey(word) { const key = String(word?.text || word || "").trim().toLowerCase(); return /^[a-z]{2}/.test(key) ? key.slice(0, 2) : /^[a-z]/.test(key) ? key[0] : "other"; }
function loadAiShard(key) {
  if (!AI_EXAMPLE_INDEX[key]) return Promise.resolve();
  if (AI_EXAMPLE_LOADS.has(key)) return AI_EXAMPLE_LOADS.get(key);
  const task = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${AI_EXAMPLE_INDEX[key]}?v=20260821-02`;
    script.onload = () => { Object.assign(AI_EXAMPLE_LIBRARY, window.WORD_AI_EXAMPLE_CHUNK?.entries || {}); resolve(); };
    script.onerror = () => reject(new Error("例句分片加载失败"));
    document.head.append(script);
  });
  AI_EXAMPLE_LOADS.set(key, task);
  return task;
}
function hydrateAiContexts(words) {
  let changed = false;
  words.forEach((word) => {
    const verified = selectedLearningContext(word);
    if (verified && word.sentenceSource !== `ai-verified:${VERIFIED_EXAMPLE_REVISION}`) {
      Object.assign(word, { sentence: verified.sentence, translation: verified.zh, sentenceTargetForm: verified.targetForm, sentenceSenseId: verified.senseId, sentencePartOfSpeech: verified.contextPartOfSpeech, sentenceSense: verified.contextSense, sentenceSource: `ai-verified:${VERIFIED_EXAMPLE_REVISION}` });
      changed = true;
    }
  });
  return changed;
}
async function preloadAiContexts(words, view) {
  // Examples are streamed as small two-letter shards. Only request a shard
  // when an entry is genuinely absent from the in-memory library.
  const keys = [...new Set((words || []).filter((word) => !aiRecordForWord(word)).map(aiShardKey))];
  // iPhone Safari can drop a large burst of dynamic scripts.  Loading the
  // few shards used by the visible page in sequence is slower by milliseconds
  // but prevents a sentence from silently degrading into a word-only card.
  for (const key of keys) {
    try { await loadAiShard(key); } catch { /* Keep the retry control visible. */ }
  }
  const hydrated = hydrateAiContexts(words || []);
  if (hydrated) await persist();
  if ((hydrated || keys.length) && currentView === view) render();
}
function retryAiContexts(words, view) {
  [...new Set((words || []).map(aiShardKey))].forEach((key) => AI_EXAMPLE_LOADS.delete(key));
  void preloadAiContexts(words, view);
}
function normalizedSentenceKey(sentence) {
  return String(sentence || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function verifiedExampleContexts(word) {
  const record = aiRecordForWord(word);
  if (!record) return [];
  const groups = new Map(record.senseGroups.map((group) => [group.id, group]));
  return record.examples.map((example, index) => {
    const group = groups.get(example.senseId);
    if (!group || !example.sentence || !example.translation) return null;
    return {
      sceneId: `ai-${index}`,
      sentence: example.sentence,
      zh: example.translation,
      targetForm: example.targetForm || String(word?.text || word || ""),
      senseId: group.id,
      contextPartOfSpeech: group.partOfSpeech || "词性未标注",
      contextSense: group.sense || "中文释义待补充"
    };
  }).filter(Boolean);
}
function pickLeastUsedContext(word, candidates) {
  if (!candidates.length) return null;
  const counts = new Map();
  (word.contexts || []).forEach((context) => {
    const key = context.sceneId || normalizedSentenceKey(context.sentence);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const lowest = Math.min(...candidates.map((candidate) => counts.get(candidate.sceneId || normalizedSentenceKey(candidate.sentence)) || 0));
  return shuffle(candidates.filter((candidate) => (counts.get(candidate.sceneId || normalizedSentenceKey(candidate.sentence)) || 0) === lowest))[0] || null;
}
function selectedLearningContext(word) {
  const examples = verifiedExampleContexts(word);
  if (!examples.length) return null;
  return pickLeastUsedContext(word, examples);
}
function wordProfile(word) {
  const base = wordData(word); const detail = WORD_DETAILS[word.text.toLowerCase()] || {}; const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {};
  const dictionarySenses = librarySenseEntries(word);
  const partOfSpeech = usage.currentPartOfSpeech || word.partOfSpeech || base.partOfSpeech || detail.partOfSpeech || dictionarySenses[0]?.partOfSpeech || "词性待补充";
  const currentSense = word.currentSense || base.currentSense || detail.currentSense || dictionarySenses[0]?.sense || word.definition || base.zh || "中文释义待补充";
  const suppliedOtherDefinitions = word.otherDefinitions?.length ? word.otherDefinitions : usage.otherDefinitions?.length ? usage.otherDefinitions : [];
  const derivedOtherDefinitions = dictionaryDefinitionEntries(word.definition || base.zh, partOfSpeech).filter((entry) => entry.sense !== currentSense);
  return {
    partOfSpeech,
    currentSense,
    senses: word.senses?.length ? word.senses : base.senses?.length ? base.senses : detail.senses?.length ? detail.senses : [word.definition || base.zh || "中文释义待补充"],
    otherDefinitions: suppliedOtherDefinitions.length ? suppliedOtherDefinitions : derivedOtherDefinitions
  };
}
function hydrateLocalContent(words = state.words) {
  let changed = false;
  (words || []).forEach((word) => {
    const base = wordData(word); const detail = WORD_DETAILS[word.text.toLowerCase()] || {}; const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {};
    const verified = selectedLearningContext(word);
    const fields = { definition: base.zh, phonetic: base.phonetic, sentence: base.sentence, translation: base.translation, partOfSpeech: usage.currentPartOfSpeech || base.partOfSpeech || detail.partOfSpeech, currentSense: base.currentSense || detail.currentSense, senses: base.senses || detail.senses, otherDefinitions: usage.otherDefinitions };
    Object.entries(fields).forEach(([field, value]) => {
      if (!word[field] && value) { word[field] = value; changed = true; }
    });
    if (detail.currentSense && word.currentSense !== detail.currentSense) { word.currentSense = detail.currentSense; changed = true; }
    if (detail.senses && JSON.stringify(word.senses) !== JSON.stringify(detail.senses)) { word.senses = detail.senses; changed = true; }
    if (usage.currentPartOfSpeech && word.partOfSpeech !== usage.currentPartOfSpeech) { word.partOfSpeech = usage.currentPartOfSpeech; changed = true; }
    if (usage.otherDefinitions && JSON.stringify(word.otherDefinitions) !== JSON.stringify(usage.otherDefinitions)) { word.otherDefinitions = usage.otherDefinitions; changed = true; }
    if (verified && word.sentenceSource !== `ai-verified:${VERIFIED_EXAMPLE_REVISION}`) {
      Object.assign(word, { sentence: verified.sentence, translation: verified.zh, sentenceTargetForm: verified.targetForm, sentenceSenseId: verified.senseId, sentencePartOfSpeech: verified.contextPartOfSpeech, sentenceSense: verified.contextSense, sentenceSource: `ai-verified:${VERIFIED_EXAMPLE_REVISION}` });
      changed = true;
    }
    if (word.learningSeen && !word.learnedAt) { const source = word.learningPlanDate ? `${word.learningPlanDate}T12:00:00+08:00` : word.createdAt; if (source) { word.learnedAt = new Date(source).toISOString(); changed = true; } }
  });
  return changed;
}
function beijingDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}
function dailyQuote(scope = "home") {
  const [year, month, day] = beijingDateKey().split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  const scopes = ["home", "words", "learn", "review", "memory", "settings"];
  const scopeNumber = Math.max(0, scopes.indexOf(scope));
  const [en, zh] = DAILY_QUOTES[(dayNumber + scopeNumber) % DAILY_QUOTES.length];
  return { en, zh };
}
function migrateNotebookState() {
  let changed = false;
  if (!Array.isArray(state.notebooks) || !state.notebooks.length) {
    const notebook = { id: id("notebook"), name: "我的单词本", createdAt: new Date().toISOString(), archivedAt: null };
    state.notebooks = [notebook]; state.activeNotebookId = notebook.id;
    state.words.forEach((word) => { word.notebookId = notebook.id; });
    state.batches.forEach((batch) => { batch.notebookId = notebook.id; });
    return true;
  }
  const available = state.notebooks.filter((notebook) => !notebook.archivedAt);
  if (!available.length) { state.notebooks[0].archivedAt = null; changed = true; }
  const active = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId && !notebook.archivedAt) || state.notebooks.find((notebook) => !notebook.archivedAt);
  if (state.activeNotebookId !== active.id) { state.activeNotebookId = active.id; changed = true; }
  state.words.forEach((word) => { if (!word.notebookId) { word.notebookId = state.activeNotebookId; changed = true; } });
  state.batches.forEach((batch) => { if (!batch.notebookId) { batch.notebookId = state.activeNotebookId; changed = true; } });
  return changed;
}
function activeNotebook() { return state.notebooks.find((notebook) => notebook.id === state.activeNotebookId && !notebook.archivedAt) || state.notebooks.find((notebook) => !notebook.archivedAt) || null; }
function defaultMemoryTable(notebook = {}) {
  return { mode: "recite", filter: "all", hideReciteDefinitions: false, hideDictationDefinitions: false, updatedAt: notebook.updatedAt || notebook.createdAt || new Date().toISOString() };
}
function migrateMemoryTableState() {
  let changed = false;
  const filters = new Set(["all", ...MEMORY_STEPS.map((step) => step.id), "complete"]);
  (state.notebooks || []).forEach((notebook) => {
    const previous = notebook.memoryTable && typeof notebook.memoryTable === "object" ? notebook.memoryTable : {};
    const legacyHideAll = Boolean(previous.hideAll);
    const normalized = { ...defaultMemoryTable(notebook), mode: previous.mode === "dictation" ? "dictation" : "recite", filter: filters.has(previous.filter) ? previous.filter : "all", hideReciteDefinitions: typeof previous.hideReciteDefinitions === "boolean" ? previous.hideReciteDefinitions : legacyHideAll, hideDictationDefinitions: typeof previous.hideDictationDefinitions === "boolean" ? previous.hideDictationDefinitions : legacyHideAll, hideReciteDefinitionsUpdatedAt: previous.hideReciteDefinitionsUpdatedAt || previous.updatedAt || notebook.updatedAt || null, hideDictationDefinitionsUpdatedAt: previous.hideDictationDefinitionsUpdatedAt || previous.updatedAt || notebook.updatedAt || null, updatedAt: previous.updatedAt || notebook.updatedAt || notebook.createdAt || new Date().toISOString() };
    if (JSON.stringify(previous) !== JSON.stringify(normalized)) { notebook.memoryTable = normalized; changed = true; }
  });
  return changed;
}
function memoryPrefs(notebook = activeNotebook()) {
  if (!notebook) return defaultMemoryTable();
  if (!notebook.memoryTable || typeof notebook.memoryTable !== "object") notebook.memoryTable = defaultMemoryTable(notebook);
  return notebook.memoryTable;
}
function memoryProgress(word) { return word?.memoryTable && typeof word.memoryTable === "object" ? word.memoryTable : { steps: {} }; }
function memoryStepRecord(word, stepId) { return memoryProgress(word).steps?.[stepId] || null; }
function memoryStepComplete(word, stepId) { return Boolean(memoryStepRecord(word, stepId)?.completed); }
function memoryFirstIncompleteStep(word) { return MEMORY_STEPS.find((step) => !memoryStepComplete(word, step.id)) || null; }
function memoryDirectoryKey(word) { return memoryFirstIncompleteStep(word)?.id || "complete"; }
function memoryModeKey(prefs = memoryPrefs()) { return prefs?.mode === "dictation" ? "dictation" : "recite"; }
function memoryHideAll(prefs = memoryPrefs(), mode = memoryModeKey(prefs)) { return Boolean(mode === "dictation" ? prefs?.hideDictationDefinitions : prefs?.hideReciteDefinitions); }
function memoryRevealedDefinitionIds(mode = memoryModeKey()) {
  const ids = memoryRevealedDefinitions.get(mode);
  if (ids) return ids;
  const created = new Set(); memoryRevealedDefinitions.set(mode, created);
  return created;
}

function memoryFilterIncludes(word, filter) {
  if (filter === "all") return true;
  return memoryDirectoryKey(word) === filter || memoryPendingDirectoryExits.get(word.id) === filter;
}
function releaseMemoryPendingDirectoryExits() {
  if (!memoryPendingDirectoryExits.size) return false;
  memoryPendingDirectoryExits.clear();
  return true;
}

function memoryWords() {
  return activeWords().filter((word) => word.learnedAt).sort((left, right) => (Date.parse(left.learnedAt) || 0) - (Date.parse(right.learnedAt) || 0));
}
function memoryMatchesSearch(word, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const profile = wordProfile(word);
  return `${word.text} ${profile.partOfSpeech} ${profile.currentSense} ${(profile.otherDefinitions || []).map((item) => item.sense).join(" ")}`.toLowerCase().includes(needle);
}
function memoryDefinitionHtml(word, prefs) {
  const progress = memoryProgress(word);
  const mode = memoryModeKey(prefs); const hidden = memoryHideAll(prefs, mode) ? !memoryRevealedDefinitionIds(mode).has(word.id) : Boolean(progress.definitionHiddenByMode?.[mode] ?? progress.definitionHidden);
  if (hidden) return `<button class="memory-meaning is-hidden" data-memory-toggle-definition="${word.id}" aria-label="显示 ${escapeHtml(word.text)} 的词性和中文释义"><span>······</span></button>`;
  const meanings = memoryDefinitions(word);
  return `<button class="memory-meaning" data-memory-toggle-definition="${word.id}" aria-label="隐藏 ${escapeHtml(word.text)} 的词性和中文释义">${meanings.map((item) => `<span><b>${escapeHtml(item.partOfSpeech)}</b>${escapeHtml(item.sense)}</span>`).join("") || "<span><b>—</b>中文释义待补充</span>"}</button>`;
}
function memoryCircle(word, step, mode) {
  const complete = memoryStepComplete(word, step.id);
  const disabled = mode === "dictation" && !complete;
  const label = complete ? `取消 ${step.label} 标记` : `标记 ${step.label} 已记住`;
  return `<button class="memory-circle ${complete ? "is-complete" : ""}" data-memory-step="${step.id}" data-memory-word="${word.id}" aria-label="${label}" ${disabled ? "disabled" : ""}><span aria-hidden="true">✓</span></button>`;
}
function memoryWordCell(word, mode) {
  if (mode !== "dictation") return `<button class="memory-term memory-speak" type="button" data-speak-text="${escapeHtml(word.text)}" aria-label="朗读 ${escapeHtml(word.text)}">${escapeHtml(word.text)}</button>`;
  const next = memoryFirstIncompleteStep(word);
  return `<div class="memory-entry"><input data-memory-spelling="${word.id}" type="text" inputmode="text" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="输入英文" aria-label="默写 ${escapeHtml(word.text)}" ${next ? "" : "disabled"} /><small data-memory-feedback="${word.id}">${next ? "" : "已完成"}</small></div>`;
}
function memoryFilterLabel(filter) { return MEMORY_STEPS.find((step) => step.id === filter)?.label || (filter === "complete" ? "完成" : "全部"); }
function memoryDirectoryItems(words) {
  return [{ id: "all", label: "全部" }, ...MEMORY_STEPS.map((step) => ({ id: step.id, label: step.label })), { id: "complete", label: "完成" }]
    .map((item) => ({ ...item, count: item.id === "all" ? words.length : words.filter((word) => memoryDirectoryKey(word) === item.id).length }));
}
function memoryStepDescription() { return MEMORY_STEPS.map((step) => step.label).join(" · "); }
function activeWords() { const notebook = activeNotebook(); return notebook ? state.words.filter((word) => word.notebookId === notebook.id) : []; }
function isReleasedForStudy(word) { return RELEASED_EXAMPLE_WORDS.has(String(word?.text || word || "").toLowerCase()); }
function studyWords() { return activeWords().filter(isReleasedForStudy); }
function activeLogs() { const ids = new Set(activeWords().map((word) => word.id)); return state.logs.filter((log) => ids.has(log.wordId)); }
function dailyNewCount() { const today = beijingDateKey(); return studyWords().filter((word) => word.learningPlanDate === today).length; }
function learnedDateKey(word) { return word.learnedAt ? beijingDateKey(word.learnedAt) : word.learningSeen ? word.learningPlanDate || (word.createdAt ? beijingDateKey(word.createdAt) : null) : null; }
function learningCountForDate(dateKey) { return studyWords().filter((word) => learnedDateKey(word) === dateKey).length; }
function reviewCountForDate(dateKey) { return activeLogs().filter((log) => beijingDateKey(log.reviewedAt) === dateKey).length; }
function dailyLearnedCount() { return learningCountForDate(beijingDateKey()); }
function dailyReviewCount() { return reviewCountForDate(beijingDateKey()); }
function studyHistoryDays() {
  const dates = new Set();
  studyWords().forEach((word) => { const dateKey = learnedDateKey(word); if (dateKey) dates.add(dateKey); });
  activeLogs().forEach((log) => { if (log.reviewedAt) dates.add(beijingDateKey(log.reviewedAt)); });
  if (!dates.size) dates.add(beijingDateKey());
  const today = beijingDateKey();
  return [...dates].sort((a, b) => b.localeCompare(a)).map((dateKey) => ({ dateKey, learned: learningCountForDate(dateKey), reviewed: reviewCountForDate(dateKey), isToday: dateKey === today }));
}
function monthKey(dateKey = beijingDateKey()) { return String(dateKey).slice(0, 7); }
function shiftMonth(month, offset) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 1 + offset, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthLabel(month) { const [year, value] = month.split("-").map(Number); return `${year}年${value}月`; }
function studyCalendarCells(month, records) {
  const [year, value] = month.split("-").map(Number); const first = new Date(Date.UTC(year, value - 1, 1)); const offset = (first.getUTCDay() + 6) % 7; const count = new Date(Date.UTC(year, value, 0)).getUTCDate(); const recordMap = new Map(records.map((item) => [item.dateKey, item])); const slots = Math.ceil((offset + count) / 7) * 7; const today = beijingDateKey();
  return Array.from({ length: slots }, (_, index) => { const day = index - offset + 1; if (day < 1 || day > count) return null; const dateKey = `${month}-${String(day).padStart(2, "0")}`; const record = recordMap.get(dateKey); return { dateKey, day, learned: record?.learned || 0, reviewed: record?.reviewed || 0, isToday: dateKey === today, hasRecord: Boolean(record) }; });
}
function reviewCurveDays(dayCount = 7) {
  return Array.from({ length: dayCount }, (_, offset) => {
    const dateKey = beijingDateKey(new Date(Date.now() + offset * 86400000));
    const due = studyWords().filter((word) => {
      if (word.stage === "sameDay") return offset === 0;
      if (word.stage !== "review" || !word.dueAt) return false;
      const dueDate = new Date(word.dueAt); return dueDate <= now() ? offset === 0 : beijingDateKey(dueDate) === dateKey;
    }).length;
    return { dateKey, due, isToday: offset === 0 };
  });
}
function shortDate(dateKey) { const [, month, day] = dateKey.split("-"); return `${Number(month)}月${Number(day)}日`; }
function movePastLearningToReview() {
  const today = beijingDateKey();
  const completedBeforeToday = studyWords().filter((word) => word.stage === "learning" && word.learningSeen && word.learningPlanDate && word.learningPlanDate < today);
  completedBeforeToday.forEach((word) => {
    word.stage = "review";
    word.dueAt = new Date().toISOString();
  });
  return completedBeforeToday.length;
}
function assignDailyStudyWords(words) {
  const movedToReview = movePastLearningToReview();
  if (movedToReview) persist();
  const today = beijingDateKey(); const target = Math.max(1, Number(state.settings.dailyNewTarget) || 200);
  let planned = words.filter((word) => word.learningPlanDate === today);
  if (planned.length < target) {
    // A missed word is carried forward before any untouched word is scheduled.
    // Words seen before today have already moved to review, while words seen
    // today remain visible in today's plan.
    const carryOver = words.filter((word) => word.stage === "learning" && !word.learningSeen && word.learningPlanDate && word.learningPlanDate < today);
    // When the review backlog reaches its safety threshold, retain an
    // existing plan and its carry-over words, but do not add fresh words.
    const untouched = isGateClosed() ? [] : words.filter((word) => word.stage === "learning" && !word.learningSeen && !word.learningPlanDate);
    const add = [...carryOver, ...untouched].slice(0, target - planned.length);
    if (add.length) { add.forEach((word) => { word.learningPlanDate = today; }); planned = [...planned, ...add]; persist(); }
  }
  return planned;
}
function dailyStudyWordsForBatch(batch) {
  if (!batch) return [];
  return assignDailyStudyWords(wordsForBatch(batch).filter(isReleasedForStudy));
}
function dailyStudyWords() { return assignDailyStudyWords(studyWords()); }
function overdueReviewCount() { return studyWords().filter((word) => word.stage === "review" && word.dueAt && new Date(word.dueAt) <= now()).length; }
function dailyPlanSummary(planned = dailyStudyWords()) {
  const configuredTarget = Math.max(1, Number(state.settings.dailyNewTarget) || 200);
  const plannedCount = planned.length;
  const learned = planned.filter((word) => word.learningSeen).length;
  return { planned, plannedCount, learned, remaining: Math.max(0, plannedCount - learned), configuredTarget, displayTarget: Math.max(configuredTarget, plannedCount), overdue: overdueReviewCount(), gateClosed: isGateClosed() };
}
function showToast(message) { TOAST.textContent = message; TOAST.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => TOAST.classList.remove("is-visible"), 2800); }
function applyTheme() { document.documentElement.dataset.theme = state.settings.darkMode ? "dark" : "light"; document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.settings.darkMode ? "#1c1c1e" : "#f6f4ef"); }
async function load() {
  let payload;
  const isStaticMobileApp = !["127.0.0.1", "localhost"].includes(window.location.hostname);
  if (isStaticMobileApp) {
    storageMode = "device";
    payload = { state: await loadDeviceState() };
  } else {
    try {
      const response = await apiFetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取本地数据");
      payload = await response.json();
    } catch {
      storageMode = "device";
      payload = { state: await loadDeviceState() };
    }
  }
  homeScreenRecoveryPending = Boolean(isStaticMobileApp && isHomeScreenWebApp() && !hasStoredWords(payload.state) && !payload.state?.settings?.pwaRecoveryDismissed);
  state = payload.state && payload.state.settings ? payload.state : makeInitialState();
  const voiceSpeedUpdated = upgradeVoiceSpeedSettings(state.settings);
  const settingsUpdated = Object.keys(DEFAULT_SETTINGS).some((key) => !(key in state.settings));
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const syncWasNormalized = !state.sync || typeof state.sync !== "object" || (!state.sync.enabled && Boolean(state.sync.key));
  const syncScopeUpdated = Boolean(state.sync?.enabled && Number(state.sync.contentVersion) < CLOUD_SYNC_CONTENT_VERSION);
  syncConfig();
  if (syncScopeUpdated) { state.sync.contentVersion = CLOUD_SYNC_CONTENT_VERSION; state.sync.dirty = true; }
  const removedLegacyAiSettings = ["aiEnabled", "aiEndpoint", "aiModel"].some((key) => key in state.settings);
  ["aiEnabled", "aiEndpoint", "aiModel"].forEach((key) => delete state.settings[key]);
  const notebookUpdated = migrateNotebookState();
  const memoryTableUpdated = migrateMemoryTableState();
  // On iPhone, `wordProfile()` already reads the bundled metadata whenever a
  // word is shown.  Avoid an eager full-library migration here: walking 5,487
  // words at launch blocks Safari's main thread before the interface responds.
  const contentUpdated = storageMode === "device" ? false : hydrateLocalContent();
  document.documentElement.dataset.reduceMotion = String(state.settings.reducedMotion);
  applyTheme();
  selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === state.activeNotebookId))?.id || null;
  if (homeScreenRecoveryPending) currentView = "home";
  render();
  void requestPersistentDeviceStorage();
  scheduleSenseLibraryLoad();
  if (contentUpdated || voiceSpeedUpdated || settingsUpdated || notebookUpdated || memoryTableUpdated || removedLegacyAiSettings || syncWasNormalized || syncScopeUpdated || deviceStateLoadedFromLegacy) persist();
  scheduleOfflineDictionaryHydration();
  if (canUseCloudSync()) {
    setCloudSyncStatus(state.sync.dirty ? "本地改动待同步 · 将在 4 小时内自动同步" : state.sync.lastSyncedAt ? `已同步 · ${formatCloudSyncDate(state.sync.lastSyncedAt)}（北京时间）` : "准备就绪 · 点击立即同步，或等待自动同步");
    startCloudSyncPolling();
    void syncCloudState({ automatic: true });
  }
}
function persist({ skipCloud = false, silent = false, defer = false } = {}) {
  state.updatedAt = new Date().toISOString();
  if (!skipCloud && canUseCloudSync()) syncConfig().dirty = true;
  // A vocabulary tap must update the screen immediately.  Serialising the
  // complete device profile can be tens of megabytes on iPhone, so coalesce
  // rapid "seen" updates into one save after the interaction has settled.
  if (defer) {
    deferredPersistOptions = { silent };
    clearTimeout(deferredPersistTimer);
    deferredPersistTimer = setTimeout(() => {
      const pending = deferredPersistOptions || { silent: true };
      deferredPersistTimer = null;
      deferredPersistOptions = null;
      void persist({ skipCloud: true, silent: pending.silent });
    }, 850);
    if (!skipCloud) scheduleCloudSync();
    return saving;
  }
  if (deferredPersistTimer) {
    clearTimeout(deferredPersistTimer);
    deferredPersistTimer = null;
    deferredPersistOptions = null;
  }
  saving = saving.catch(() => undefined).then(async () => {
    if (storageMode === "device") {
      if (!(await saveDeviceState(state))) throw new Error("无法建立本机数据库；请不要使用无痕浏览，并确认 Safari 没有阻止网站数据");
      return;
    }
    const response = await apiFetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    if (!response.ok) throw new Error("保存失败");
  }).catch(async (error) => {
    if (storageMode === "server") {
      storageMode = "device";
      if (await saveDeviceState(state)) { if (!silent) showToast("服务未连接，已改为保存到本设备。 "); return; }
    }
    if (!skipCloud && canUseCloudSync()) {
      scheduleCloudSync();
      if (!silent) showToast("本机存储受限，学习记录会继续同步到加密云端。");
      return;
    }
    if (!silent) showToast(`本机保存失败：${error.message}`);
  });
  if (!skipCloud) scheduleCloudSync();
  return saving;
}
function navigate(view) { currentView = view; question = null; window.location.hash = view; render(); APP.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? "auto" : "smooth" }); }
function getBatch() { const batches = state.batches.filter((batch) => batch.notebookId === state.activeNotebookId); return batches.find((batch) => batch.id === selectedBatchId) || lastItem(batches) || null; }
function wordsForBatch(batch) { return batch ? batch.wordIds.map((wordId) => state.words.find((word) => word.id === wordId && word.notebookId === state.activeNotebookId)).filter(Boolean) : []; }
function queue() {
  const regularLimit = Math.max(0, (Number(state.settings.dailyReviewTarget) || 30) - dailyReviewCount());
  const due = studyWords().filter((word) => word.stage === "sameDay" || (word.stage === "review" && word.dueAt && new Date(word.dueAt) <= now()) || (word.stage === "mastered" && Number(word.masteredCycles) === 1 && word.masteryCheckDueAt && new Date(word.masteryCheckDueAt) <= now())).sort((a, b) => { const rank = (word) => word.stage === "sameDay" ? 0 : word.stage === "review" ? 1 : 2; return rank(a) - rank(b) || String(a.dueAt || a.masteryCheckDueAt || "").localeCompare(String(b.dueAt || b.masteryCheckDueAt || "")); });
  // Same-day consolidation belongs to today's new-word plan. It remains
  // available even after the regular-review target has been reached.
  const sameDay = due.filter((word) => word.stage === "sameDay");
  const regular = due.filter((word) => word.stage !== "sameDay");
  return [...sameDay, ...regular.slice(0, regularLimit)];
}
function dueCount() { return queue().length; }
function isGateClosed() { return overdueReviewCount() >= Math.max(1, Number(state.settings.reviewGate) || 100); }
function incompleteCount() { return studyWords().filter((word) => word.stage === "learning").length; }
function renderNav() {
  document.querySelectorAll("[data-nav]").forEach((button) => button.classList.toggle("is-active", button.dataset.nav === currentView));
  const total = dueCount();
  document.querySelectorAll("#review-count, [data-review-count]").forEach((count) => { count.textContent = total; count.dataset.zero = String(total === 0); });
  document.querySelectorAll("[data-toggle-theme]").forEach((themeButton) => { themeButton.textContent = state.settings.darkMode ? "日间" : "夜间"; themeButton.setAttribute("aria-label", state.settings.darkMode ? "切换到日间模式" : "切换到夜间模式"); });
}
function pageHeading(title) { const quote = dailyQuote({ "词表": "words", "学习": "learn", "复习": "review", "记忆": "memory", "设置": "settings" }[title] || "home"); return `<div class="page-heading"><div><h1>${title}</h1><p class="daily-quote"><span>${quote.en}</span><em>${quote.zh}</em></p></div></div>`; }

function renderHomeScreenRecovery() {
  APP.innerHTML = `<section class="home-page home-screen-recovery"><p class="eyebrow">主屏幕版 · 首次打开</p><h1 class="display">先恢复你的<br />词本。</h1><p class="lede">iPhone 会把浏览器和主屏幕应用的本机数据分开保存。你的词本没有被清空；输入浏览器版中使用的同步密钥，即可安全恢复。</p><section class="home-screen-recovery-card"><div><p class="section-label">从浏览器词境恢复</p><h2>恢复已有词本</h2><ol><li>在浏览器版打开“设置”。</li><li>在“云端自动同步”中复制密钥并点“立即同步”。</li><li>回到这里输入同一密钥。</li></ol></div><label class="field-label">同步密钥<input data-home-screen-sync-key type="text" autocomplete="off" spellcheck="false" placeholder="粘贴浏览器里的同步密钥" /></label><div class="backup-actions"><button class="primary" data-recover-home-screen>恢复词本</button><button class="quiet-button" data-dismiss-home-screen-recovery>这是一个空白新词本</button></div>${homeScreenRecoveryError ? `<p class="home-screen-recovery-error" role="alert">${escapeHtml(homeScreenRecoveryError)}</p>` : ""}</section><p class="note">如果浏览器版从未启用同步，请在浏览器“设置 → 数据备份”导出备份，再在这里的“设置”中恢复该文件。</p></section>`;
}

function renderHome() {
  if (homeScreenRecoveryPending) { renderHomeScreenRecovery(); return; }
  const plan = dailyPlanSummary();
  const due = dueCount(); const learning = incompleteCount(); const total = activeWords().length; const completed = activeLogs().length; const quote = dailyQuote("home"); const studyDays = studyHistoryDays(); const curveDays = reviewCurveDays();
  const primaryView = due ? "review" : plan.remaining ? "learn" : learning ? "learn" : total ? "words" : "words";
  const primaryLabel = due ? `开始复习 · ${due} 词` : plan.remaining ? `继续学习 · ${plan.remaining} 词` : learning ? `继续学习 · ${learning} 词` : total ? "查看词表" : "导入一小批词";
  const message = plan.gateClosed ? `先清理 <em>${plan.overdue}</em> 个到期复习。` : due ? `今天，重新遇见 <em>${due}</em> 个词。` : plan.remaining ? `让 <em>${plan.remaining}</em> 个词进入语境。` : total ? "此刻，没有到期的复习。" : "从一小批词开始。";
  APP.innerHTML = `<section class="home-page"><p class="eyebrow">${escapeHtml(activeNotebook()?.name || "我的单词本")} · 本地学习</p><h1 class="display">${message}</h1><p class="lede daily-home-quote"><span>${quote.en}</span><em>${quote.zh}</em></p><div class="action-row"><button class="primary" data-go="${primaryView}">${primaryLabel}</button>${total ? `<button class="secondary" data-go="words">管理词表</button>` : ""}</div><div class="home-shelf"><section><p class="section-label">今日节奏 · 北京时间</p>${taskCard("学习", `${dailyLearnedCount()} / ${state.settings.dailyNewTarget} 词已学习。`, "learn", "继续")}${taskCard("复习", `${dailyReviewCount()} / ${state.settings.dailyReviewTarget} 词已完成复习。`, "review", "开始")}</section><aside><p class="section-label">当前单词本</p><dl class="stat-list"><div><dt>词表中的词</dt><dd>${total}</dd></div><div><dt>已完成的复习</dt><dd>${completed}</dd></div><div><dt>目标记忆率</dt><dd>${Math.round(state.settings.targetRetention * 100)}%</dd></div></dl></aside></div><div class="home-insights"><section class="home-insight memory-curve"><div class="insight-heading"><div><p class="section-label">间隔复习</p><h2>记忆曲线</h2></div><span>未来 7 天</span></div><ol class="curve-days">${curveDays.map((item) => `<li class="${item.isToday ? "is-today" : ""}"><time datetime="${item.dateKey}">${item.isToday ? "今天" : shortDate(item.dateKey)}</time><strong>${item.due}</strong><small>待复习</small></li>`).join("")}</ol></section><section class="home-insight study-history"><div class="insight-heading"><div><p class="section-label">学习记录</p><h2>每日学习与复习</h2></div><span>全部 ${studyDays.length} 天</span></div><ol class="activity-days">${studyDays.map((item) => `<li class="${item.isToday ? "is-today" : ""}"><time datetime="${item.dateKey}"><b>${item.isToday ? "今天" : shortDate(item.dateKey)}</b><span>${item.dateKey}</span></time><p><strong>学 ${item.learned}</strong><strong>复 ${item.reviewed}</strong></p></li>`).join("")}</ol></section></div></section>`;
  APP.querySelector(".home-shelf")?.insertAdjacentHTML("afterend", `<section class="daily-plan-overview ${plan.gateClosed ? "is-gated" : ""}"><div><p class="section-label">今日计划</p><h2>${plan.plannedCount} / ${plan.displayTarget} 词</h2></div><p>${plan.gateClosed ? `到期复习已有 ${plan.overdue} 词；今天不再加入全新单词。` : plan.plannedCount ? (plan.remaining ? `还剩 ${plan.remaining} 词待初学；未完成的词会优先续入明天。` : "今日初学已完成；当天学习页会保留已学词。") : "导入后会在这里安排已核对例句的单词。"}<small>${plan.plannedCount > plan.configuredTarget ? `今天已固定 ${plan.plannedCount} 词；新的目标从明天起生效。` : `每日目标 ${plan.configuredTarget} 词。`}</small></p></section>`);
  APP.querySelector(".memory-curve .section-label").textContent = "预计复习安排";
  APP.querySelector(".memory-curve h2").textContent = "未来复习";
  APP.querySelector(".memory-curve .insight-heading > span").textContent = "预测，不是学习记录";
  APP.querySelectorAll(".curve-days li").forEach((item, index) => { item.querySelector("small").textContent = index === 0 ? "今日待复习" : "预计到期"; });
  const currentMonth = monthKey(); const earliestMonth = monthKey(lastItem(studyDays)?.dateKey || currentMonth);
  if (!historyCalendarMonth || historyCalendarMonth < earliestMonth || historyCalendarMonth > currentMonth) historyCalendarMonth = currentMonth;
  const calendarCells = studyCalendarCells(historyCalendarMonth, studyDays);
  APP.querySelector(".study-history").innerHTML = `<div class="insight-heading"><div><p class="section-label">学习记录</p><h2>学习日历</h2></div><span>全部 ${studyDays.length} 天</span></div><div class="calendar-toolbar"><button class="quiet-button" data-history-month="-1" ${historyCalendarMonth <= earliestMonth ? "disabled" : ""}>← 上月</button><strong>${monthLabel(historyCalendarMonth)}</strong><button class="quiet-button" data-history-month="1" ${historyCalendarMonth >= currentMonth ? "disabled" : ""}>下月 →</button></div><ol class="calendar-weekdays"><li>一</li><li>二</li><li>三</li><li>四</li><li>五</li><li>六</li><li>日</li></ol><ol class="study-calendar">${calendarCells.map((item) => item ? `<li class="${item.isToday ? "is-today" : ""} ${item.hasRecord ? "has-record" : ""}"><time datetime="${item.dateKey}">${item.day}</time>${item.hasRecord ? `<span>学 ${item.learned}</span><span>复 ${item.reviewed}</span>` : ""}</li>` : `<li class="is-empty" aria-hidden="true"></li>`).join("")}</ol>`;
}
function taskCard(title, copy, go, action) { return `<article class="task-card"><h3>${title}</h3><p>${copy}</p><button class="task-link" data-go="${go}">${action} →</button></article>`; }

function friendlyPartOfSpeech(value) {
  return String(value || "词性未标注").split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean).join(" / ") || "词性未标注";
}
function friendlySense(value) {
  return String(value || "")
    .replace(/\binterj\.\s*/gi, "")
    .replace(/[\[【]计算机[\]】]\s*/g, "（计算机用语）")
    .replace(/[\[【]医[\]】]\s*/g, "（医学）")
    .replace(/[\[【]法[\]】]\s*/g, "（法律）")
    .replace(/^计算机\s*[：:]?\s*/g, "（计算机用语）")
    .replace(/^医\s*[：:]?\s*/g, "（医学）")
    .replace(/^法\s*[：:]?\s*/g, "（法律）")
    .replace(/\s+/g, " ").trim();
}
function groupDefinitions(entries, { limitGroups = 4, limitSenses = 3 } = {}) {
  const grouped = new Map();
  entries.forEach((entry) => {
    const partOfSpeech = entry.partOfSpeech || "词性未标注";
    const sense = friendlySense(entry.sense);
    if (!sense) return;
    const senses = grouped.get(partOfSpeech) || [];
    if (!senses.includes(sense)) senses.push(sense);
    grouped.set(partOfSpeech, senses);
  });
  return [...grouped.entries()].slice(0, limitGroups).map(([partOfSpeech, senses]) => ({ partOfSpeech: friendlyPartOfSpeech(partOfSpeech), sense: senses.join("；").split("；").slice(0, limitSenses).join("；") }));
}
function allDefinitions(word) {
  const dictionarySenses = librarySenseEntries(word);
  if (dictionarySenses.length) return groupDefinitions(dictionarySenses);
  const profile = wordProfile(word);
  const definitions = [{ partOfSpeech: profile.partOfSpeech, sense: profile.currentSense }, ...profile.otherDefinitions];
  return groupDefinitions(definitions);
}
function memoryDefinitions(word) {
  const dictionarySenses = librarySenseEntries(word);
  if (dictionarySenses.length) return groupDefinitions(dictionarySenses, { limitGroups: Infinity, limitSenses: Infinity });
  const profile = wordProfile(word);
  const definitions = [{ partOfSpeech: profile.partOfSpeech, sense: profile.currentSense }, ...profile.otherDefinitions];
  return groupDefinitions(definitions, { limitGroups: Infinity, limitSenses: Infinity });
}
function otherDefinitionsFor(word, sentenceSense) {
  const currentParts = friendlySense(sentenceSense).split(/[；;、，,]/).map((item) => item.trim()).filter(Boolean);
  return allDefinitions(word).map((entry) => {
    const parts = friendlySense(entry.sense).split(/[；;、，,]/).map((item) => item.trim()).filter(Boolean);
    const remaining = parts.filter((part) => !currentParts.some((current) => current === part || (current.length > 1 && part.includes(current)) || (part.length > 1 && current.includes(part))));
    return { ...entry, sense: remaining.join("；") };
  }).filter((entry) => entry.sense);
}
function definitionList(word) { return allDefinitions(word).map((item) => `<li><span>${escapeHtml(item.partOfSpeech)}</span>${escapeHtml(item.sense)}</li>`).join(""); }
function regionPager(region, page, pageCount) {
  return `<div class="region-pager"><button class="quiet-button" data-${region}-page="${page - 1}" ${page === 0 ? "disabled" : ""}>上一页</button><span>第 ${page + 1} / ${pageCount} 页</span><button class="quiet-button" data-${region}-page="${page + 1}" ${page === pageCount - 1 ? "disabled" : ""}>下一页</button></div>`;
}
function allDefinitionEntries(word) {
  return allDefinitions(word);
}
function wordLibraryCard(word, mistakeCount = 0) {
  const definitions = allDefinitionEntries(word);
  return `<button class="word-library-item" data-speak-word="${word.id}" aria-label="朗读 ${escapeHtml(word.text)}"><span class="word-library-term">${escapeHtml(word.text)}</span><span class="word-library-definitions">${definitions.map((entry) => `<span class="word-library-meaning"><b>${escapeHtml(entry.partOfSpeech || "")}</b>${escapeHtml(entry.sense)}</span>`).join("")}</span>${mistakeCount ? `<small>错 ${mistakeCount} 次</small>` : ""}</button>`;
}
function masteredWordRow(word) { return `<div class="mastered-word-row">${wordLibraryCard(word)}<button class="mastered-word-delete" data-delete-mastered-word="${word.id}" aria-label="从词库删除 ${escapeHtml(word.text)}">删除</button></div>`; }
function matchesWordLibrarySearch(word, query) {
  const needle = String(query || "").trim().toLowerCase();
  return !needle || word.text.toLowerCase().includes(needle);
}
function renderWords() {
  let words = activeWords(); const notebook = activeNotebook(); const mistakeCounts = new Map(); const searching = Boolean(librarySearch.trim());
  const notebookOptions = state.notebooks.filter((item) => !item.archivedAt).map((item) => `<option value="${item.id}" ${item.id === notebook?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  activeLogs().filter((log) => !log.correct).forEach((log) => mistakeCounts.set(log.wordId, (mistakeCounts.get(log.wordId) || 0) + 1));
  let mistakeWords = words.filter((word) => mistakeCounts.has(word.id)).sort((a, b) => mistakeCounts.get(b.id) - mistakeCounts.get(a.id) || a.text.localeCompare(b.text));
  mistakeWords = mistakeWords.filter((word) => matchesWordLibrarySearch(word, librarySearch));
  const masteredWords = words.filter((word) => word.stage === "mastered" && matchesWordLibrarySearch(word, librarySearch)).sort((a, b) => a.text.localeCompare(b.text));
  const savedMatches = words.filter((word) => word.stage !== "mastered" && matchesWordLibrarySearch(word, librarySearch));
  const preferMistakes = searching && mistakeWords.length > 0;
  const preferSaved = searching && !preferMistakes && savedMatches.length > 0;
  const preferMastered = searching && !preferMistakes && !preferSaved && masteredWords.length > 0;
  words = preferMistakes || preferMastered ? [] : savedMatches;
  if (searching && (preferSaved || (!preferMistakes && !preferMastered))) savedWordsExpanded = true;
  if (searching && preferMastered) masteredWordsExpanded = true;
  const mistakePages = Math.max(1, Math.ceil(mistakeWords.length / WORDS_PAGE_SIZE)); mistakePage = Math.max(0, Math.min(mistakePage, mistakePages - 1));
  const savedPages = Math.max(1, Math.ceil(words.length / WORDS_PAGE_SIZE)); savedPage = Math.max(0, Math.min(savedPage, savedPages - 1));
  const masteredPages = Math.max(1, Math.ceil(masteredWords.length / WORDS_PAGE_SIZE)); masteredPage = Math.max(0, Math.min(masteredPage, masteredPages - 1));
  const mistakeList = mistakeWords.length ? mistakeWords.slice(mistakePage * WORDS_PAGE_SIZE, (mistakePage + 1) * WORDS_PAGE_SIZE).map((word) => wordLibraryCard(word, mistakeCounts.get(word.id))).join("") : `<div class="empty compact-empty">${searching ? "错词库中没有匹配的单词。" : "还没有错词记录。"}</div>`;
  const savedList = words.length ? words.slice(savedPage * WORDS_PAGE_SIZE, (savedPage + 1) * WORDS_PAGE_SIZE).map((word) => wordLibraryCard(word)).join("") : `<div class="empty compact-empty">${searching ? "已保存的词中没有匹配的单词。" : "这个单词本还没有内容。"}</div>`;
  const masteredList = masteredWords.length ? masteredWords.slice(masteredPage * WORDS_PAGE_SIZE, (masteredPage + 1) * WORDS_PAGE_SIZE).map(masteredWordRow).join("") : `<div class="empty compact-empty">${searching ? "已掌握的词中没有匹配的单词。" : "还没有达到已掌握标准的单词。"}</div>`;
  APP.innerHTML = `<section>${pageHeading("词表")}<section class="wordbook-quick"><button class="wordbook-quick-toggle" data-toggle-wordbook-panel aria-expanded="${wordbookPanelExpanded}"><span>当前单词本 · <strong>${escapeHtml(notebook?.name || "我的单词本")}</strong></span><span>${wordbookPanelExpanded ? "收起" : "切换或新建"}⌄</span></button>${wordbookPanelExpanded ? `<div class="wordbook-quick-content"><label>导入到 <select data-active-notebook aria-label="导入目标单词本">${notebookOptions}</select></label><div><input id="new-notebook-name" placeholder="新单词本名称" maxlength="40" aria-label="新单词本名称" /><button class="secondary" data-create-notebook>新建单词本</button></div><button class="quiet-button" data-go="settings">归档和删除管理</button></div>` : ""}</section><div class="import-panel"><div><label class="field-label" for="word-input">粘贴英文单词</label><textarea id="word-input" placeholder="bank\nbridge\nticket\nbook"></textarea><div class="action-row"><button class="primary" data-import>导入这一批</button><button class="secondary" type="button" data-open-file>导入文件</button><input id="txt-file" data-file-input type="file" accept=".txt,.pdf,.docx,.xlsx,.xlsm,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" hidden /></div><p class="tiny">支持 TXT、PDF、Word、Excel（.xlsx / .xlsm）；文件只在此设备处理，不会上传。</p></div></div><section class="word-library mistake-library"><div class="word-library-heading"><div><p class="section-label">复习记录</p><h2>错词库 <span>${mistakeWords.length} 词</span></h2></div><p>按错误次数排序</p></div><div class="word-library-grid">${mistakeList}</div>${mistakeWords.length ? regionPager("mistake", mistakePage, mistakePages) : ""}</section><section class="word-library saved-library"><button class="word-library-toggle" data-toggle-saved-words aria-expanded="${savedWordsExpanded}"><span><span class="section-label">本地词表</span><strong>已保存的词 <i>${words.length}</i></strong></span><span>${savedWordsExpanded ? "收起" : "展开"}⌄</span></button>${savedWordsExpanded ? `<div class="word-library-grid">${savedList}</div>${words.length ? regionPager("saved", savedPage, savedPages) : ""}` : ""}</section></section>`;
  const fileInput = APP.querySelector("#txt-file");
  const fileButton = APP.querySelector("[data-open-file]");
  if (fileInput && fileButton) {
    const fileLabel = document.createElement("label");
    fileLabel.className = "secondary file-import-button";
    fileLabel.textContent = "导入文件";
    fileInput.hidden = false;
    fileInput.className = "file-import-input";
    fileLabel.append(fileInput);
    fileButton.replaceWith(fileLabel);
  }
  APP.querySelector(".import-aside")?.remove();
  APP.querySelector(".mistake-library")?.insertAdjacentHTML("afterend", `<section class="word-library mastered-library"><button class="word-library-toggle" data-toggle-mastered-words aria-expanded="${masteredWordsExpanded || preferMastered}"><span><span class="section-label">复习成果</span><strong>已掌握的词 <i>${masteredWords.length}</i></strong></span><span>${masteredWordsExpanded || preferMastered ? "收起" : "展开"}⌄</span></button>${masteredWordsExpanded || preferMastered ? `<div class="word-library-grid mastered-word-grid">${masteredList}</div>${masteredWords.length ? regionPager("mastered", masteredPage, masteredPages) : ""}` : ""}</section>`);
  APP.querySelector(".import-panel")?.insertAdjacentHTML("afterend", `<label class="word-library-search library-search"><span>搜索单词</span><input data-library-search="all" value="${escapeHtml(librarySearch)}" placeholder="输入英文单词" autocomplete="off" />${searching ? `<small class="library-search-result">${preferMistakes ? "已优先显示错词库" : preferSaved ? "显示已保存的词" : preferMastered ? "显示已掌握的词" : "没有匹配的单词"}</small>` : ""}</label>`);
  const masteredLibrary = APP.querySelector(".mastered-library");
  if (searching && preferMistakes) { APP.querySelector(".saved-library")?.remove(); masteredLibrary?.remove(); }
  else if (searching && preferSaved) { APP.querySelector(".mistake-library")?.remove(); masteredLibrary?.remove(); }
  else if (searching && preferMastered) { APP.querySelector(".mistake-library")?.remove(); APP.querySelector(".saved-library")?.remove(); }
  else if (searching) { APP.querySelector(".mistake-library")?.remove(); masteredLibrary?.remove(); }
}

function textWithToken(sentence, surfaceForm, dictionaryWord = surfaceForm) { const escapedSentence = escapeHtml(sentence); const needle = escapeHtml(surfaceForm); const index = escapedSentence.toLowerCase().indexOf(needle.toLowerCase()); if (index < 0) return escapedSentence; return `${escapedSentence.slice(0, index)}<button class="word-token" data-popover-word="${escapeHtml(dictionaryWord)}">${escapedSentence.slice(index, index + needle.length)}</button>${escapedSentence.slice(index + needle.length)}`; }
const IRREGULAR_SENTENCE_FORMS = {
  am: "be 动词现在时", are: "be 动词现在时", is: "be 动词第三人称单数现在时", was: "be 动词过去式", were: "be 动词过去式", been: "be 动词过去分词",
  did: "动词过去式", done: "动词过去分词", went: "动词过去式", gone: "动词过去分词", had: "动词过去式／过去分词",
  made: "动词过去式／过去分词", wrote: "动词过去式", written: "动词过去分词", took: "动词过去式", taken: "动词过去分词",
  ran: "动词过去式", run: "动词过去分词", came: "动词过去式", seen: "动词过去分词", saw: "动词过去式",
  spoke: "动词过去式", spoken: "动词过去分词", taught: "动词过去式／过去分词", thought: "动词过去式／过去分词",
  bought: "动词过去式／过去分词", chose: "动词过去式", chosen: "动词过去分词", rose: "动词过去式", risen: "动词过去分词",
  paid: "动词过去式／过去分词", rode: "动词过去式", ridden: "动词过去分词", forgot: "动词过去式", forgotten: "动词过去分词"
};
function sentenceFormLabel(word, targetForm, sentence) {
  const base = String(word.text || "").toLowerCase();
  const form = String(targetForm || "").toLowerCase();
  if (!form || form === base) return "";
  const before = String(sentence || "").toLowerCase().slice(0, String(sentence || "").toLowerCase().indexOf(form));
  const followsPerfectAuxiliary = /\b(?:have|has|had|haven't|hasn't|hadn't)\s*$/.test(before);
  if (IRREGULAR_SENTENCE_FORMS[form]) return IRREGULAR_SENTENCE_FORMS[form];
  if (form.endsWith("ing")) return "动词现在分词／动名词";
  if (form.endsWith("ed")) return followsPerfectAuxiliary ? "动词过去分词" : "动词过去式";
  if (form.endsWith("ies") || form.endsWith("es") || form.endsWith("s")) {
    return String(word.sentencePartOfSpeech || word.partOfSpeech || "").startsWith("n") ? "名词复数" : "动词第三人称单数";
  }
  return "词形变化";
}
function storyLine(word, index) {
  const isCurrentVerifiedExample = word.sentenceSource === `ai-verified:${VERIFIED_EXAMPLE_REVISION}`;
  const sentence = isCurrentVerifiedExample ? word.sentence : "";
  const translation = isCurrentVerifiedExample ? word.translation : "";
  if (!sentence || !translation) {
    const loadingWasAttempted = AI_EXAMPLE_LOADS.has(aiShardKey(word));
    const heldForReview = loadingWasAttempted && !aiRecordForWord(word);
    return `<section class="story-unit learning-loading-card" id="learning-word-${word.id}" style="--line-index:${index}"><p class="reading-kicker">${heldForReview ? "例句正在复核" : "正在准备学习语境"}</p><h3>${escapeHtml(word.text)}</h3><p>${heldForReview ? "这一个词的旧例句没有通过中英文质量检查，已暂停展示；不会用不通顺的句子凑数。" : "正在载入这一个词已核对的例句。不会用自动拼接的简单句代替。"}</p>${heldForReview ? "" : `<button class="quiet-button" data-retry-examples="${word.id}">重新载入例句</button>`}</section>`;
  }
  const targetForm = word.sentenceTargetForm || word.text;
  const formLabel = sentenceFormLabel(word, targetForm, sentence);
  const grammarNote = formLabel ? `<p class="sentence-form-note">本句形式：${escapeHtml(targetForm)}（${escapeHtml(formLabel)}）</p>` : "";
  return `<div class="story-unit" id="learning-word-${word.id}" style="--line-index:${index}"><p class="story-line">${textWithToken(sentence, targetForm, word.text)}<button class="speaker" data-speak-sentence="${escapeHtml(sentence)}" aria-label="朗读这一句">${SPEAKER_ICON}</button></p><div class="story-actions">${grammarNote}<div class="translation-action-row"><button class="translation-toggle" data-show-translation="${word.id}">查看句子意思</button></div></div><p class="story-translation" data-translation-panel="${word.id}">${escapeHtml(translation)}</p></div>`;
}
function renderLearn() {
  const plannedWords = dailyStudyWords();
  if (!plannedWords.length) {
    learningPlanWordIds = new Set(); learningPlanSeenCount = 0; learningPlanTotal = 0;
    const noReleasedWords = !studyWords().length;
    const gateClosed = isGateClosed();
    const canRecoverEmptyHomeScreen = Boolean(noReleasedWords && storageMode === "device" && isHomeScreenWebApp() && !hasStoredWords(state));
    const title = gateClosed ? "今天先完成复习。" : noReleasedWords ? "正在准备可学习的词。" : "今天没有新的学习安排。";
    const copy = gateClosed ? `到期复习已有 ${overdueReviewCount()} 词；完成一部分后会自动恢复新词安排。` : canRecoverEmptyHomeScreen ? "这个主屏幕版尚未接入浏览器里的词本。可以恢复已有词本，无需重新导入。" : noReleasedWords ? "导入的单词将在已核对的例句准备完成后加入每日计划。" : "当前词本中的新词已安排完毕。";
    const action = gateClosed ? `<button class="primary" data-go="review">去复习</button>` : canRecoverEmptyHomeScreen ? `<button class="primary" data-open-home-screen-recovery>恢复已有词本</button><button class="secondary" data-go="words">这是新词本，去导入</button>` : noReleasedWords ? `<button class="primary" data-go="words">去导入词表</button>` : `<button class="secondary" data-go="words">查看词表</button>`;
    APP.innerHTML = `<section class="done-state"><p class="eyebrow">学习</p><h2>${title}</h2><p>${copy}</p><div class="action-row">${action}</div></section>`;
    return;
  }  // Keep today's completed words visible for the rest of the day. Tomorrow,
  // `dailyStudyWords` omits them from the new-learning plan.
  const batchWords = plannedWords;
  const pageCount = Math.max(1, Math.ceil(batchWords.length / LEARNING_PAGE_SIZE)); learnPage = Math.max(0, Math.min(learnPage, pageCount - 1));
  const pageWords = batchWords.slice(learnPage * LEARNING_PAGE_SIZE, (learnPage + 1) * LEARNING_PAGE_SIZE); const viewed = plannedWords.filter((word) => word.learningSeen).length; const missing = batchWords.filter((word) => !word.definition).length;
  learningPlanWordIds = new Set(plannedWords.map((word) => word.id)); learningPlanSeenCount = viewed; learningPlanTotal = plannedWords.length;
  const ready = plannedWords.some((word) => word.stage === "learning"); const allSeen = viewed === plannedWords.length;
  const sidebar = pageWords.map((word) => `<button class="learning-word-nav ${word.learningSeen ? "is-seen" : ""}" data-jump-word="${word.id}"><strong>${escapeHtml(word.text)}</strong><span data-learning-status="${word.id}">${word.learningSeen ? "已学习" : "未学习"}</span></button>`).join("");
  const pageButtons = `<div class="learn-pagination"><button class="secondary" data-learn-page="${learnPage - 1}" ${learnPage === 0 ? "disabled" : ""}>上一页</button><span>第 ${learnPage + 1} / ${pageCount} 页 · ${pageWords.length} 词</span><button class="secondary" data-learn-page="${learnPage + 1}" ${learnPage === pageCount - 1 ? "disabled" : ""}>下一页</button></div>`;
  const readingContent = pageWords.map((word, index) => storyLine(word, index)).join("");
  const footerAction = ready
    ? `<button class="primary" data-complete-learning ${allSeen ? "" : "disabled"}>完成初学，进入当日巩固</button>`
    : `<button class="secondary" data-go="review">前往复习</button>`;
  APP.innerHTML = `<section class="learning-page">${pageHeading("学习")}<div class="daily-progress-line">今日已学习 <strong>${viewed} / ${plannedWords.length}</strong> 个单词</div><div class="learn-workspace"><aside class="learning-sidebar"><p class="section-label">本页词表</p><p class="learning-summary" data-learning-summary>已学习 <strong>${viewed}</strong> / ${plannedWords.length}</p><div class="learning-word-list">${sidebar}</div>${pageButtons}</aside><article class="reading-sheet"><p class="reading-kicker">${ready ? "学习语境" : "完成初学"}</p><h2 class="story-title">Learn at your own pace.</h2>${readingContent}<footer class="story-footer">${missing ? `<span class="note">还有 ${missing} 个词缺少中文释义。</span>` : ""}${footerAction}</footer>${pageButtons}</article></div></section>`;
}

function contextTextKey(context) { return `${String(context.zh || "").toLowerCase()}|${String(context.sentence || "").toLowerCase()}`.replace(/\s+/g, " ").trim(); }
function reviewContextForWord(word) {
  const verified = verifiedExampleContexts(word);
  if (verified.length) {
    const last = word.lastSenseAttempt || {};
    const previousSentence = String(last.sentenceKey || "");
    let candidates = verified;
    if (last.senseId && last.correct) {
      const differentSense = verified.filter((item) => item.senseId !== last.senseId);
      candidates = differentSense.length ? differentSense : verified.filter((item) => normalizedSentenceKey(item.sentence) !== previousSentence);
    } else if (last.senseId && last.correct === false) {
      const sameSenseNewSentence = verified.filter((item) => item.senseId === last.senseId && normalizedSentenceKey(item.sentence) !== previousSentence);
      // A lapse must never replay the identical sentence. Prefer another
      // example for the same sense; if that sense has only one verified
      // sentence, use a different verified sense until its second example is
      // added during the next corpus revision.
      candidates = sameSenseNewSentence.length ? sameSenseNewSentence : verified.filter((item) => normalizedSentenceKey(item.sentence) !== previousSentence);
    }
    return pickLeastUsedContext(word, candidates.length ? candidates : verified);
  }
  // A review question must always have a verified full sentence.  The caller
  // waits for the relevant local shard instead of falling back to a legacy
  // sentence or a Chinese-definition-only question.
  return null;
}
function clozeSentence(sentence, targetForm) {
  const escaped = String(targetForm || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i");
  return matcher.test(sentence) ? sentence.replace(matcher, "____") : sentence;
}
function studyFormForWord(word) {
  const forms = [...new Set(verifiedExampleContexts(word).map((item) => item.targetForm).filter(Boolean))];
  return shuffle(forms)[0] || word.text;
}
function wordForStudyForm(form) {
  const normalized = String(form || "").toLowerCase();
  return studyWords().find((word) => word.text.toLowerCase() === normalized || verifiedExampleContexts(word).some((item) => String(item.targetForm).toLowerCase() === normalized));
}
function partFamily(partOfSpeech) {
  const value = String(partOfSpeech || "").toLowerCase();
  return ["adj", "adv", "aux", "prep", "pron", "conj", "num", "n", "v"].find((part) => new RegExp(`(^|[^a-z])${part}\\.?($|[^a-z])`).test(value)) || "";
}
function supportsPartOfSpeech(word, family) {
  if (!family) return true;
  return allDefinitions(word).some((item) => partFamily(item.partOfSpeech) === family) || partFamily(wordProfile(word).partOfSpeech) === family;
}
function formKind(form, family) {
  const value = String(form || "").toLowerCase();
  if (family === "v" && value.endsWith("ing")) return "ing";
  if (family === "v" && value.endsWith("ed")) return "ed";
  if ((family === "v" || family === "n") && value.endsWith("s") && value.length > 3) return "s";
  return "base";
}
function regularForm(base, kind) {
  const value = String(base || "").toLowerCase();
  if (!value || kind === "base") return base;
  const consonantY = value.endsWith("y") && !/[aeiou]y$/.test(value);
  if (kind === "s") return consonantY ? `${value.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/.test(value) ? `${value}es` : `${value}s`;
  if (kind === "ed") return consonantY ? `${value.slice(0, -1)}ied` : value.endsWith("e") ? `${value}d` : `${value}ed`;
  if (kind === "ing") return value.endsWith("ie") ? `${value.slice(0, -2)}ying` : value.endsWith("e") && !value.endsWith("ee") ? `${value.slice(0, -1)}ing` : `${value}ing`;
  return base;
}
function challengingFormForWord(candidate, targetForm, targetPart) {
  const desiredKind = formKind(targetForm, targetPart);
  const recorded = verifiedExampleContexts(candidate).map((item) => item.targetForm).filter(Boolean);
  const matchingRecorded = recorded.filter((form) => formKind(form, targetPart) === desiredKind);
  if (matchingRecorded.length) return shuffle(matchingRecorded)[0];
  if (desiredKind === "base") return studyFormForWord(candidate);
  // Never manufacture forms such as "regardinging". If this word has no
  // attested matching form, use its headword as the fair distractor.
  return targetPart === "v" && !/(?:ing|ed)$/i.test(candidate.text) ? regularForm(candidate.text, desiredKind) : candidate.text;
}
function meaningCharacters(word) {
  const ignored = new Set(["的", "和", "与", "及", "或", "使", "被", "为", "性", "中", "于", "一", "个"]);
  return new Set(allDefinitions(word).flatMap((item) => [...String(item.sense || "")]).filter((character) => /[\u3400-\u9fff]/.test(character) && !ignored.has(character)));
}
function meaningOverlap(left, right) {
  const leftSet = meaningCharacters(left); const rightSet = meaningCharacters(right);
  let shared = 0; leftSet.forEach((character) => { if (rightSet.has(character)) shared += 1; });
  return shared / Math.max(1, Math.min(leftSet.size, rightSet.size));
}
function createQuestion(word) {
  const context = reviewContextForWord(word);
  const targetForm = context.targetForm || word.text;
  // Inflected-form recall complements normal lemma recall; it must not replace
  // it. The majority of reviews still consolidate the headword and its sense.
  const questionMode = targetForm.toLowerCase() !== word.text.toLowerCase() && Math.random() < 0.35 ? "form" : "lemma";
  const answer = questionMode === "form" ? targetForm : word.text;
  const normalizedAnswer = answer.toLowerCase();
  const others = studyWords().filter((candidate) => candidate.id !== word.id);
  const targetPart = partFamily(context.contextPartOfSpeech);
  const samePart = others.filter((candidate) => supportsPartOfSpeech(candidate, targetPart));
  const confusable = samePart.filter((candidate) => meaningOverlap(word, candidate) > 0).sort((left, right) => meaningOverlap(word, right) - meaningOverlap(word, left));
  const remainingSamePart = shuffle(samePart.filter((candidate) => !confusable.includes(candidate)));
  const answers = []; const seenAnswers = new Set([normalizedAnswer]);
  for (const candidate of [...confusable, ...remainingSamePart, ...shuffle(others)]) {
    // Distractors deliberately come from the whole notebook. A form seen in
    // another word's verified sentence is fair game, not just a variant of the
    // current target word.
    const option = challengingFormForWord(candidate, targetForm, targetPart); const normalized = option.toLowerCase();
    if (!seenAnswers.has(normalized)) { answers.push(option); seenAnswers.add(normalized); }
    if (answers.length === 3) break;
  }
  for (const fallback of ["bridge", "ticket", "book", "window", "garden", "travel"]) {
    if (!seenAnswers.has(fallback)) { answers.push(fallback); seenAnswers.add(fallback); }
    if (answers.length === 3) break;
  }
  return { wordId: word.id, ...context, targetForm, questionMode, answer, fullSentence: context.sentence, sentence: context.sentence ? clozeSentence(context.sentence, targetForm) : "", options: shuffle([answer, ...answers.slice(0, 3)]), showingOptions: false, hintUsed: false, answered: false, selected: null, startedAt: Date.now() };
}
function getQuestion() { if (!question) { const card = queue()[0]; if (card) question = createQuestion(card); } return question; }
function renderReview() {
  const items = queue(); const isHistorical = Boolean(question?.historical);
  if (!items.length && !isHistorical) { APP.innerHTML = `<section class="done-state"><p class="eyebrow">复习</p><h2>此刻，已经足够。</h2><p>没有到期的词需要复习。完成初学后，当日巩固会出现在这里；之后由 FSRS 根据实际作答安排下一次相遇。</p><div class="action-row">${reviewHistory.length ? `<button class="secondary" data-previous-question>上一题</button>` : ""}${incompleteCount() ? `<button class="primary" data-go="learn">继续学习</button>` : `<button class="secondary" data-go="words">查看词表</button>`}</div></section>`; return; }
  if (!isHistorical && !question && items[0] && !verifiedExampleContexts(items[0]).length) {
    APP.innerHTML = `<section class="review-layout"><article class="review-card review-loading"><p class="review-kind">准备复习</p><h1>正在载入本题例句…</h1><p>复习只会使用已核对的完整语境，不会退回为“根据中文找单词”。</p><button class="secondary" data-retry-examples="${items[0].id}">重新载入例句</button></article></section>`;
    void preloadAiContexts([items[0]], "review");
    return;
  }
  const item = getQuestion(); const card = state.words.find((word) => word.id === item.wordId); const isSameDay = card.stage === "sameDay"; const memory = memoryState(card); const hasSentence = Boolean(item.sentence); const spokenSentence = item.fullSentence || item.sentence.replace("____", item.answer || card.text); const promptContent = hasSentence ? `<h1 class="cloze">${escapeHtml(item.sentence).replace("____", '<span class="cloze-blank">&nbsp;</span>')}<button class="speaker" data-speak-sentence="${escapeHtml(spokenSentence)}" aria-label="朗读例句">${SPEAKER_ICON}</button></h1>` : `<h1 class="definition-recall">根据释义选择对应的单词</h1>`;
  const recallModeLabel = item.questionMode === "form" ? "回忆横线处的正确词形" : "回忆这个语境对应的单词原形";
  let bottom = `<p class="recall-prompt">${recallModeLabel}，再决定要不要验证答案。</p><div class="action-row"><button class="primary" data-reveal="false">我想起来了，验证答案</button><button class="quiet-button" data-reveal="true">显示候选（使用提示）</button></div>`;
  if (item.showingOptions) { const choices = item.options.slice(0, 4).map((option, index) => { const optionWord = wordForStudyForm(option) || { text: option }; const profile = wordProfile(optionWord); const isCorrect = item.answered && option === item.answer; const isWrongSelection = item.answered && option === item.selected && option !== item.answer; const isExpanded = isCorrect || isWrongSelection; const meaning = isCorrect ? { partOfSpeech: friendlyPartOfSpeech(item.contextPartOfSpeech || profile.partOfSpeech), currentSense: friendlySense(item.contextSense || profile.currentSense) } : { partOfSpeech: friendlyPartOfSpeech(profile.partOfSpeech), currentSense: friendlySense(profile.currentSense) }; const otherMeanings = isCorrect ? otherDefinitionsFor(optionWord, meaning.currentSense).slice(0, 3) : []; const speaker = `data-speak-text="${escapeHtml(option)}"`; return `<article class="choice ${isCorrect ? "is-correct" : ""} ${isWrongSelection ? "is-wrong" : ""}"><button class="choice-select" data-choice="${escapeHtml(option)}" ${item.answered ? "disabled" : ""}><span class="key">${index + 1}</span><span class="choice-label">${escapeHtml(option)}</span>${isCorrect ? `<span class="choice-result">正确答案</span>` : isWrongSelection ? `<span class="choice-result">你的选择</span>` : ""}</button>${isExpanded ? `<div class="choice-detail"><div><small>${isCorrect ? "本句释义" : "释义"}</small><span class="choice-pos">${escapeHtml(meaning.partOfSpeech)}</span><span class="choice-meaning">${escapeHtml(meaning.currentSense)}</span>${isCorrect && otherMeanings.length ? `<div class="choice-other-meanings"><small>其他常见释义</small>${otherMeanings.map((entry) => `<span>${escapeHtml(entry.partOfSpeech)} ${escapeHtml(entry.sense)}</span>`).join("")}</div>` : ""}</div><button class="speaker choice-speaker" ${speaker} aria-label="朗读 ${escapeHtml(option)}">${SPEAKER_ICON}</button></div>` : ""}</article>`; }).join(""); bottom = `<div class="choices">${choices}</div>${item.answered ? answerPanel(card, item) : `<p class="recall-prompt">${item.questionMode === "form" ? "选择最合适的词形。" : "选择横线单词的原形。"}${item.hintUsed ? " 已记录为使用提示。" : ""}</p>`}`; }
  const kindLabel = hasSentence ? (item.questionMode === "form" ? "核对过的语境 · 词形辨析" : isSameDay ? "核对过的语境 · 当日巩固" : "核对过的语境 · 词义回忆") : "释义复习";
  APP.innerHTML = `<section class="review-layout"><div class="review-progress"><span><i class="dot"></i>${isHistorical ? `回看第 ${(reviewHistoryIndex ?? 0) + 1} 题` : isSameDay ? "当日巩固" : "到期复习"}</span></div><article class="review-card"><div class="review-card-nav"><button class="quiet-button" data-previous-question ${reviewHistory.length ? "" : "disabled"}>← 上一题</button><b class="review-remaining">${isHistorical ? "不会重复计分" : `待完成 ${items.length} 词`}</b>${isHistorical ? `<button class="quiet-button" data-next-question>回到当前题 →</button>` : ""}</div><p class="review-kind">${kindLabel}</p><p class="scene-cn">${escapeHtml(item.zh)}</p>${promptContent}${bottom}</article></section>`;
}
function answerPanel(card, item) {
  const correct = item.selected === item.answer;
  const label = correct ? (item.hintUsed ? "答对了，且使用了候选提示。" : "答对了，这次回忆很清晰。") : "这次没有选对。已把它带回更短的间隔。";
  const grammarForm = item.targetForm && item.targetForm.toLowerCase() !== card.text.toLowerCase() ? `<p>本句形式：<b>${escapeHtml(item.targetForm)}</b>（单词原形：${escapeHtml(card.text)}）</p>` : "";
  const followup = correct ? "已按记忆曲线安排下一次复习。" : "已安排更短间隔，稍后会再出现。";
  return `<div class="review-answer ${correct ? "answer-correct" : "answer-wrong"}"><strong>${label}</strong>${grammarForm}<p class="next-review-note">${followup}</p><div class="action-row"><button class="primary" data-next-question>${item.historical ? "回到当前题" : "下一题"} <span class="tiny">Enter</span></button></div></div>`;
}

function renderMemory() {
  const notebook = activeNotebook(); const prefs = memoryPrefs(notebook); const orderedWords = memoryWords();
  const serials = new Map(orderedWords.map((word, index) => [word.id, index + 1]));
  const directory = memoryDirectoryItems(orderedWords);
  const filtered = orderedWords.filter((word) => memoryFilterIncludes(word, prefs.filter) && memoryMatchesSearch(word, memorySearch));
  const visible = filtered.slice(0, memoryVisibleCount); const mode = prefs.mode;
  const rows = visible.map((word) => `<div class="memory-row" role="row"><div class="memory-cell memory-index is-sticky" role="cell">${serials.get(word.id)}</div><div class="memory-cell memory-word is-sticky" role="cell">${memoryWordCell(word, mode)}</div><div class="memory-cell memory-definition is-sticky" role="cell">${memoryDefinitionHtml(word, prefs)}</div>${MEMORY_STEPS.map((step) => `<div class="memory-cell memory-step" role="cell">${memoryCircle(word, step, mode)}</div>`).join("")}</div>`).join("");
  const body = rows || `<div class="memory-empty">${orderedWords.length ? "这个目录中还没有单词。" : "完成一次初学后，单词会按最初学习顺序出现在这里。"}</div>`;
  APP.innerHTML = `<section class="memory-page">${pageHeading("记忆")}<section class="memory-lead"><div><p class="section-label">${escapeHtml(notebook?.name || "我的单词本")} · 独立记录</p><h2>循着自己的记忆痕迹。</h2><p>按首次学习顺序排列；圆点只记录你的手动记忆，不影响 FSRS 复习。</p></div><div class="memory-summary"><strong>${orderedWords.length}</strong><span>已学习单词</span></div></section><div class="memory-toolbar"><div class="memory-modes" role="tablist" aria-label="记忆方式"><button class="memory-mode ${mode === "recite" ? "is-active" : ""}" data-memory-mode="recite" role="tab" aria-selected="${mode === "recite"}">背诵</button><button class="memory-mode ${mode === "dictation" ? "is-active" : ""}" data-memory-mode="dictation" role="tab" aria-selected="${mode === "dictation"}">默写</button></div><button class="quiet-button memory-hide-all" data-memory-hide-all aria-label="${prefs.hideAll ? "显示全部词性和释义" : "隐藏全部词性和释义"}">${prefs.hideAll ? "显示" : "隐藏"}</button><label class="memory-search"><span>搜索</span><input data-memory-search type="search" value="${escapeHtml(memorySearch)}" placeholder="英文或中文" autocomplete="off" /></label></div><div class="memory-workspace"><aside class="memory-sidebar"><p class="section-label">目录</p><nav class="memory-directory" aria-label="记忆目录">${directory.map((item) => `<button class="memory-directory-item ${prefs.filter === item.id ? "is-active" : ""}" data-memory-filter="${item.id}"><span>${item.label}</span><b>${item.count}</b></button>`).join("")}</nav></aside><section class="memory-table-card"><div class="memory-table-caption"><div><p class="section-label">${mode === "dictation" ? "默写" : "背诵"}</p><h2>${memoryFilterLabel(prefs.filter)}</h2></div><p>${mode === "dictation" ? "直接在英文框中书写；核对正确后自动填满下一个空圆。" : "先回忆释义，再点按对应圆点。"}</p></div><div class="memory-table-scroll"><div class="memory-table" role="table" aria-label="${escapeHtml(notebook?.name || "当前")}单词本记忆表"><div class="memory-row memory-head" role="row"><div class="memory-cell memory-index is-sticky" role="columnheader">序号</div><div class="memory-cell memory-word is-sticky" role="columnheader">${mode === "dictation" ? "默写" : "英文"}</div><div class="memory-cell memory-definition is-sticky" role="columnheader">释义</div>${MEMORY_STEPS.map((step) => `<div class="memory-cell memory-step" role="columnheader">${step.label}</div>`).join("")}</div>${body}</div></div>${visible.length < filtered.length ? `<button class="secondary memory-more" data-memory-more>更多</button>` : ""}</section></div><p class="memory-footnote">节点：${memoryStepDescription()}。切换单词本会切换整张记忆表与全部记录。</p></section>`;
  const summary = APP.querySelector(".memory-summary");
  const sidebar = APP.querySelector(".memory-sidebar");
  if (summary && sidebar) sidebar.prepend(summary);
  APP.querySelector(".memory-lead")?.remove();
  const hideAll = memoryHideAll(prefs);
  const hideControl = APP.querySelector("[data-memory-hide-all]");
  if (hideControl) { hideControl.textContent = hideAll ? "显示" : "隐藏"; hideControl.setAttribute("aria-label", hideAll ? "显示当前模式全部词性和释义" : "隐藏当前模式全部词性和释义"); }
  const search = APP.querySelector("[data-memory-search]");
  if (search) { search.placeholder = "搜索英文或中文"; search.setAttribute("aria-label", "搜索"); }
  const directoryHeading = APP.querySelector(".memory-sidebar .section-label");
  if (directoryHeading) directoryHeading.textContent = "本页词表";
}

function renderSettings() {
  const voices = englishVoices(); const voiceOptions = voices.length ? voices.map((voice) => `<option value="${escapeHtml(voice.voiceURI)}" ${voice.voiceURI === state.settings.voiceURI ? "selected" : ""}>${escapeHtml(voice.name)} · ${voice.lang}</option>`).join("") : `<option value="">系统将自动选择可用英语声音</option>`;
  const notebooks = state.notebooks.filter((notebook) => !notebook.archivedAt); const archived = state.notebooks.filter((notebook) => notebook.archivedAt); const current = activeNotebook();
  const notebookOptions = notebooks.map((notebook) => `<option value="${notebook.id}" ${notebook.id === current?.id ? "selected" : ""}>${escapeHtml(notebook.name)} · ${state.words.filter((word) => word.notebookId === notebook.id).length} 词</option>`).join("");
  const archivedRows = archived.length ? `<div class="archived-books">${archived.map((notebook) => `<div><span>${escapeHtml(notebook.name)} · ${state.words.filter((word) => word.notebookId === notebook.id).length} 词</span><button class="quiet-button" data-restore-notebook="${notebook.id}">恢复</button><button class="quiet-button danger-button" data-delete-notebook="${notebook.id}">彻底删除</button></div>`).join("")}</div>` : "";
  const sectionLabels = ["单词本", "今日计划", "英语发音", "显示与动效", "数据备份", "云端同步", "重置学习记录", "学习记录与导出", "学习规则"];
  const plan = dailyPlanSummary();
  APP.innerHTML = `<section>${pageHeading("设置")}<div class="settings-grid settings-workspace"><aside class="settings-sidebar"><nav class="settings-toc" aria-label="设置目录"><p>设置目录</p>${sectionLabels.map((label, index) => `<button class="settings-toc-link" data-scroll-setting="${index}">${label}</button>`).join("")}</nav></aside><div class="settings-content"><section class="setting-group"><h2>单词本</h2><div class="setting-stack"><label class="field-label">当前单词本 <select data-active-notebook aria-label="当前单词本">${notebookOptions}</select></label><div class="notebook-create"><input id="new-notebook-name" placeholder="例如：雅思核心词" maxlength="40" aria-label="新单词本名称" /><button class="secondary" data-create-notebook>新建单词本</button></div><div class="notebook-actions"><button class="secondary" data-archive-notebook="${current?.id}">归档并保留学习记录</button><button class="quiet-button danger-button" data-delete-notebook="${current?.id}">彻底删除词与学习记录</button></div>${archivedRows}</div></section><section class="setting-group"><h2>英语发音</h2><div class="setting-stack"><select data-setting="voiceURI" aria-label="英语声音">${voiceOptions}</select><label class="field-label">句子朗读 <select data-setting="sentenceVoiceEngine" aria-label="句子朗读模式"><option value="natural" ${state.settings.sentenceVoiceEngine === "natural" ? "selected" : ""}>自然句式</option><option value="system" ${state.settings.sentenceVoiceEngine === "system" ? "selected" : ""}>快速系统朗读</option></select></label><p class="field-note">自然句式会使用更平缓的语速和音调；单词朗读仍保持快速响应。</p><label class="field-label">单词语速 <input data-number-setting="wordRate" type="number" min="0.8" max="1.5" step="0.05" value="${state.settings.wordRate}" /></label><label class="field-label">句子语速 <input data-number-setting="sentenceRate" type="number" min="0.8" max="1.6" step="0.05" value="${state.settings.sentenceRate}" /></label><div><button class="secondary" data-test-voice>试听句子朗读</button></div></div></section><section class="setting-group"><h2>显示与动效</h2><div class="setting-stack"><label class="check-row"><input data-checkbox-setting="darkMode" type="checkbox" ${state.settings.darkMode ? "checked" : ""} />夜间模式</label><label class="check-row"><input data-checkbox-setting="reducedMotion" type="checkbox" ${state.settings.reducedMotion ? "checked" : ""} />减少动态效果</label></div></section></div></div></section>`;
  APP.querySelector(".settings-content > .setting-group")?.insertAdjacentHTML("afterend", `<section class="setting-group"><h2>今日计划</h2><p class="daily-plan-setting-status ${plan.gateClosed ? "is-gated" : ""}">${plan.gateClosed ? `到期复习已有 ${plan.overdue} 词，暂缓加入全新单词。` : plan.plannedCount ? `今日已安排 ${plan.plannedCount} 词，已学习 ${plan.learned} 词，待初学 ${plan.remaining} 词。` : "尚未安排可学习的新词。"}</p><div class="setting-stack"><label class="field-label">每日新词目标 <input data-number-setting="dailyNewTarget" type="number" min="1" max="500" step="1" value="${plan.configuredTarget}" inputmode="numeric" /></label><label class="field-label">每日常规复习目标 <input data-number-setting="dailyReviewTarget" type="number" min="1" max="500" step="1" value="${state.settings.dailyReviewTarget}" inputmode="numeric" /></label><label class="field-label">复习优先门槛 <input data-number-setting="reviewGate" type="number" min="1" max="1000" step="1" value="${state.settings.reviewGate}" inputmode="numeric" /></label><p class="field-note">当天已排入的词会保留；未完成的词会优先进入明天的固定名额。当到期复习达到门槛，系统不再添加全新单词。</p></div></section>`);
  APP.querySelector(".settings-content")?.insertAdjacentHTML("beforeend", `<section class="setting-group"><h2>数据备份</h2><p>建议每隔一段时间导出一次，并将备份文件保存到“文件”或 iCloud Drive。恢复备份时会替换这台设备现有的学习记录。</p><div class="backup-actions"><button class="secondary" data-export-backup>导出备份</button><label class="secondary" for="backup-file">从备份恢复<input id="backup-file" data-backup-input type="file" accept="application/json,.json" hidden /></label></div></section>`);
  const canRecoverEmptyHomeScreen = Boolean(storageMode === "device" && isHomeScreenWebApp() && !hasStoredWords(state));
  if (canRecoverEmptyHomeScreen) APP.querySelector(".settings-content")?.insertAdjacentHTML("beforeend", `<section class="setting-group home-screen-recovery-setting"><h2>恢复已有词本</h2><p>这是 iPhone 主屏幕版的独立本机空间。粘贴浏览器版“设置 → 云端自动同步”中的同一密钥，可恢复词本和学习记录，不需要重新导入。</p><label class="field-label">同步密钥<input data-home-screen-sync-key type="text" autocomplete="off" spellcheck="false" placeholder="粘贴浏览器里的同步密钥" /></label><div class="backup-actions"><button class="primary" data-recover-home-screen>恢复已有词本</button></div>${homeScreenRecoveryError ? `<p class="home-screen-recovery-error" role="alert">${escapeHtml(homeScreenRecoveryError)}</p>` : ""}</section>`);
  const sync = syncConfig();
  const cloudSyncPanel = sync.enabled ? `<section class="setting-group cloud-sync-group"><h2>云端自动同步</h2><p><strong data-cloud-sync-status>${escapeHtml(cloudSyncStatus === "未启用" ? "准备同步" : cloudSyncStatus)}</strong></p><p>这台设备已加入你的加密同步空间。电脑、iPhone 和 iPad 输入同一同步密钥后，学习进度与复习记录会自动合并；词库和例句仍保留在每台设备本地。</p><label class="field-label">同步密钥<input id="cloud-sync-key" data-cloud-sync-key type="text" value="${escapeHtml(sync.key)}" readonly autocomplete="off" spellcheck="false" aria-label="当前同步密钥" /></label><p class="field-note">同步密钥只显示在本机；请妥善保管，不要分享给其他人。</p><div class="backup-actions"><button class="secondary" data-copy-sync-key>复制同步密钥</button><button class="secondary" data-sync-now>立即同步</button><button class="quiet-button danger-button" data-disable-sync>停止这台设备的同步</button></div></section>` : `<section class="setting-group cloud-sync-group"><h2>云端自动同步</h2><p>免费同步电脑、iPhone 和 iPad 的词本、学习进度与复习记录。请在三台设备上输入完全相同的同步密钥；密钥只保存在设备中，云端只保存加密内容。</p><label class="field-label">同步密钥<input id="cloud-sync-key" data-cloud-sync-key type="text" autocomplete="off" spellcheck="false" placeholder="至少 16 个字符；三台设备完全相同" /></label><p class="field-note">请将密钥存入密码管理器。遗失后无法从云端找回；不要把它分享给其他人。</p><div class="backup-actions"><button class="secondary" data-generate-sync-key>生成安全密钥</button><button class="primary" data-enable-sync>启用云端同步</button></div></section>`;
  APP.querySelector(".settings-content")?.insertAdjacentHTML("beforeend", cloudSyncPanel);
  APP.querySelector(".cloud-sync-group h2")?.replaceChildren(document.createTextNode("云端自动同步（每 4 小时）"));
  if (sync.enabled) {
    const syncDetail = APP.querySelector(".cloud-sync-group p:nth-of-type(2)");
    if (syncDetail) syncDetail.textContent = "云端会加密同步完整用户数据：词本、单词内容、学习状态、例句与上下文、全部复习记录、导入记录和设置。同步密钥只保存在本机。";
    APP.querySelector(".cloud-sync-group .backup-actions")?.insertAdjacentHTML("beforeend", '<button class="secondary" data-refresh-app>更新此设备</button>');
  }
  APP.querySelector(".settings-content")?.insertAdjacentHTML("beforeend", '<section class="setting-group"><h2>重置学习记录</h2><p>保留词本、单词内容和设置，清空每个单词的学习状态、复习历史与已掌握状态。启用云端同步时，重置会同步到所有已更新设备。</p><div class="backup-actions"><button class="quiet-button danger-button" data-reset-all-learning>清空所有学习与复习记录</button></div></section>');
  APP.querySelector(".settings-content")?.insertAdjacentHTML("beforeend", `<section class="setting-group"><h2>学习记录与导出</h2><p>每个已学习单词都会记录学习日期。可选择任意日期，导出所有单词本中当日学过的单词。</p><div class="setting-stack"><label class="field-label">学习日期 <input data-export-learning-date type="date" value="${beijingDateKey()}" aria-label="导出学习日期" /></label><div class="backup-actions"><button class="primary" data-export-learning-words>导出当日学习单词</button></div></div><p class="field-note">导出 CSV 共三列：序号、英文、中文意思；可直接用 Excel 或表格软件打开。</p><p>仅清除今天的学习或复习进度，不影响词本、历史学习和备份。</p><div class="backup-actions"><button class="secondary" data-clear-today-learning>清空今日学习记录</button><button class="secondary" data-clear-today-review>清空今日复习记录</button></div></section><section class="setting-group"><h2>学习规则</h2><ol class="study-rule-list"><li>优先完成今日新词与当日巩固。</li><li>到期词依记忆曲线穿插复习，较早学习的词会低频回顾。</li><li>同一词的全部例句答对，才第一次进入“已掌握”。</li><li>第一次掌握后仍会抽查；错一次即移出“已掌握”。</li><li>第二次完成全部例句后，不再进入常规复习。</li></ol></section>`);
  [...APP.querySelectorAll(".setting-group")].forEach((group, index) => { group.id = `setting-${index}`; });
  APP.querySelector("#setting-1 .setting-stack")?.insertAdjacentHTML("beforeend", `<label class="field-label">目标记忆率 <select data-number-setting="targetRetention" aria-label="目标记忆率"><option value="0.85" ${Number(state.settings.targetRetention) === .85 ? "selected" : ""}>85%</option><option value="0.9" ${Number(state.settings.targetRetention) === .9 ? "selected" : ""}>90%</option><option value="0.92" ${Number(state.settings.targetRetention) === .92 ? "selected" : ""}>92%</option><option value="0.95" ${Number(state.settings.targetRetention) === .95 ? "selected" : ""}>95%</option></select></label>`);
}

function render() {
  if (!state) return;
  ({ home: renderHome, words: renderWords, learn: renderLearn, review: renderReview, memory: renderMemory, settings: renderSettings }[currentView] || renderHome)();
  renderNav();
  if (currentView === "review" && !question?.historical) {
    const remaining = APP.querySelector(".review-remaining");
    if (remaining) remaining.textContent = `慢慢重温 ${queue().length} 个`;
  }
  if (currentView === "learn") {
    const visibleWords = dailyStudyWords().slice(learnPage * LEARNING_PAGE_SIZE, (learnPage + 1) * LEARNING_PAGE_SIZE);
    if (visibleWords.length) void preloadAiContexts(visibleWords, "learn");
  }
}

function parseWords(raw) {
  const words = [];
  String(raw || "").split(/\r?\n/).forEach((line) => {
    const clean = line.trim().toLowerCase();
    if (/^[a-z]+(?:[ '\-][a-z]+)*$/i.test(clean)) words.push(clean);
    else words.push(...(clean.match(/[a-z]+(?:['-][a-z]+)*/gi) || []).map((word) => word.toLowerCase()));
  });
  return [...new Set(words.filter((word) => word.length > 1))];
}
function isMissingDefinition(value) { return !String(value || "").trim() || /中文释义待补充|词性待补充/.test(String(value)); }
async function lookupOfflineDefinitions(words) {
  const terms = [...new Set((words || []).map((word) => String(word || "").trim().toLowerCase()).filter(Boolean))].slice(0, 1000);
  if (!terms.length) return new Map();
  if (storageMode === "device") {
    const dictionary = await loadBrowserDictionary();
    return new Map(terms.flatMap((word) => {
      const record = dictionary.get(word);
      if (!record) return [];
      const entry = offlineDictionaryEntry(word, record);
      return entry.senses.length ? [[word, entry]] : [];
    }));
  }
  try {
    const response = await apiFetch("/api/dictionary/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words: terms }) });
    if (!response.ok) return new Map();
    const payload = await response.json();
    return new Map((payload.entries || []).map((entry) => [String(entry.word || "").toLowerCase(), entry]));
  } catch { return new Map(); }
}
function applyOfflineDefinition(word, entry) {
  if (!word || !entry) return false;
  let changed = false;
  const fields = ["definition", "phonetic", "partOfSpeech", "currentSense", "senses"];
  fields.forEach((field) => {
    const value = entry[field];
    if (value && (field === "definition" ? isMissingDefinition(word[field]) : !word[field] || (Array.isArray(word[field]) && !word[field].length))) { word[field] = value; changed = true; }
  });
  return changed;
}
async function hydrateOfflineDictionary() {
  const missing = activeWords().filter((word) => isMissingDefinition(word.definition) || !word.partOfSpeech).slice(0, 1000);
  if (!missing.length) return;
  const entries = await lookupOfflineDefinitions(missing.map((word) => word.text));
  let changed = false;
  missing.forEach((word) => { changed = applyOfflineDefinition(word, entries.get(word.text.toLowerCase())) || changed; });
  if (changed) { await persist(); render(); }
}
function scheduleOfflineDictionaryHydration() {
  // The optional dictionary expands to roughly 46 MB.  On iPhone it must only
  // load after an explicit import, never in the background after first paint.
  if (storageMode === "device") return;
  if (window.__wordscapeDictionaryHydrationScheduled) return;
  window.__wordscapeDictionaryHydrationScheduled = true;
  const run = () => {
    window.__wordscapeDictionaryHydrationScheduled = false;
    void hydrateOfflineDictionary();
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3500 });
  else setTimeout(run, 2200);
}
function bundledDictionaryEntries(entries) {
  return new Map(Object.entries(entries || {}).flatMap(([word, record]) => {
    const entry = offlineDictionaryEntry(word, record);
    return entry.senses.length ? [[word, entry]] : [];
  }));
}
async function importWords(raw, source = "用户导入") {
  const parsed = parseWords(raw);
  if (!parsed.length) { showToast("没有找到可导入的英文单词。"); return; }
  const existing = new Set(activeWords().map((word) => word.text.toLowerCase()));
  const fresh = parsed.filter((word) => !existing.has(word));
  if (!fresh.length) { showToast("这些词已经在当前单词本中了。"); return; }
  const suppliedEntries = importEntryOverride || new Map();
  const missingEntries = fresh.filter((word) => !suppliedEntries.has(word));
  const offlineEntries = new Map([...suppliedEntries, ...await lookupOfflineDefinitions(missingEntries)]);
  const batchId = id("batch");
  const notebookId = state.activeNotebookId;
  const words = fresh.map((text) => {
    const base = wordData({ text });
    const detail = WORD_DETAILS[text.toLowerCase()] || {};
    const usage = WORD_USAGE_DETAILS[text.toLowerCase()] || {};
    const offline = offlineEntries.get(text) || {};
    const verified = selectedLearningContext({ text, contexts: [] });
    return {
      id: id("word"), text,
      definition: offline.definition || base.zh || "",
      phonetic: offline.phonetic || base.phonetic || "",
      sentence: verified?.sentence || "", translation: verified?.zh || "",
      sentenceTargetForm: verified?.targetForm || text, sentenceSenseId: verified?.senseId || "", sentencePartOfSpeech: verified?.contextPartOfSpeech || "", sentenceSense: verified?.contextSense || "", sentenceSource: verified ? `ai-verified:${VERIFIED_EXAMPLE_REVISION}` : "",
      partOfSpeech: usage.currentPartOfSpeech || base.partOfSpeech || detail.partOfSpeech || offline.partOfSpeech || "",
      currentSense: base.currentSense || detail.currentSense || offline.currentSense || "",
      senses: offline.senses?.length ? offline.senses : base.senses || detail.senses || [],
      otherDefinitions: usage.otherDefinitions?.length ? usage.otherDefinitions : offline.otherDefinitions || [],
      learningSeen: false, learningPlanDate: null, stage: "learning", batchId, notebookId,
      dueAt: null, stability: null, difficulty: null, lastReviewAt: null, reviewCount: 0, lapses: 0, contexts: [], createdAt: new Date().toISOString()
    };
  });
  state.words.push(...words);
  state.batches.push({ id: batchId, notebookId, wordIds: words.map((word) => word.id), source, status: "learning", createdAt: new Date().toISOString() });
  selectedBatchId = batchId;
  await persist();
  showToast(`已保存 ${words.length} 个词到「${activeNotebook()?.name}」。`);
  navigate("learn");
}
async function refreshBundledWordbookDefinitions(payload) {
  const entries = bundledDictionaryEntries(payload.entries);
  let changed = false;
  state.words.forEach((word) => {
    const entry = entries.get(word.text.toLowerCase());
    if (!entry) return;
    const usage = WORD_USAGE_DETAILS[word.text.toLowerCase()] || {};
    const updates = {
      definition: entry.definition,
      phonetic: entry.phonetic || word.phonetic,
      senses: entry.senses,
      otherDefinitions: usage.otherDefinitions?.length ? usage.otherDefinitions : entry.otherDefinitions
    };
    Object.entries(updates).forEach(([field, value]) => {
      if (value && JSON.stringify(word[field]) !== JSON.stringify(value)) { word[field] = value; changed = true; }
    });
    if (!word.currentSense && entry.currentSense) { word.currentSense = entry.currentSense; changed = true; }
    const base = wordData(word); const detail = WORD_DETAILS[word.text.toLowerCase()] || {};
    const intendedPartOfSpeech = usage.currentPartOfSpeech || base.partOfSpeech || detail.partOfSpeech || entry.partOfSpeech;
    if (intendedPartOfSpeech && word.partOfSpeech !== intendedPartOfSpeech) { word.partOfSpeech = intendedPartOfSpeech; changed = true; }
  });
  if (changed) { await persist(); render(); }
}
async function installBundledWordbook() {
  try {
    // Importing and persisting 5,487 words on a new phone makes every control
    // appear frozen. iPhone uses a cloud restore or an explicit user import
    // instead; the desktop starter flow remains unchanged.
    if (storageMode === "device" || state.words.length) return;
    const response = await fetch("./bundled-imports/27-one.json", { cache: "force-cache" });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload?.id || !payload?.notebookName || !Array.isArray(payload.words)) return;
    const applied = Array.isArray(state.appliedBundledImports) ? state.appliedBundledImports : [];
    if (applied.includes(payload.id)) { await refreshBundledWordbookDefinitions(payload); return; }
    let notebook = state.notebooks.find((item) => !item.archivedAt && item.name === payload.notebookName);
    if (!notebook) {
      notebook = { id: id("notebook"), name: payload.notebookName, createdAt: new Date().toISOString(), archivedAt: null };
      state.notebooks.push(notebook);
    }
    state.activeNotebookId = notebook.id;
    selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === notebook.id))?.id || null;
    importEntryOverride = bundledDictionaryEntries(payload.entries);
    await importWords(payload.words.join("\n"), payload.source || payload.notebookName);
    importEntryOverride = null;
    state.appliedBundledImports = [...applied, payload.id];
    await persist();
    await refreshBundledWordbookDefinitions(payload);
    showToast(`「${payload.notebookName}」已建立，已重新随机排序 ${payload.words.length} 个词。`);
  } catch {
    importEntryOverride = null;
  }
}
function updateWordDefinition(wordId, definition) { const word = state.words.find((item) => item.id === wordId); if (!word) return; word.definition = definition.trim(); persist(); }
function isBackupState(value) {
  return value && typeof value === "object" && Array.isArray(value.words) && Array.isArray(value.batches) && Array.isArray(value.logs) && value.settings && typeof value.settings === "object";
}
function exportBackup() {
  const payload = { format: "wordscape-backup", version: 1, exportedAt: new Date().toISOString(), state };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `词境备份-${beijingDateKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("备份已生成。请将文件存到“文件”或 iCloud Drive。 ");
}
function exportLearnedWords(dateKey) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) ? String(dateKey) : beijingDateKey();
  const learnedWords = state.words.filter((word) => learnedDateKey(word) === date).sort((left, right) => {
    const leftTime = Date.parse(left.learnedAt || "") || 0;
    const rightTime = Date.parse(right.learnedAt || "") || 0;
    return leftTime - rightTime || String(left.text || "").localeCompare(String(right.text || ""), "en");
  });
  if (!learnedWords.length) { showToast(`${shortDate(date)}没有可导出的学习单词。`); return; }
  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["序号", "英文", "中文意思"], ...learnedWords.map((word, index) => {
    const profile = wordProfile(word);
    const meaning = String(friendlySense(profile.currentSense || word.definition || wordData(word).zh || "中文释义待补充")).replace(/\s+/g, " ").trim();
    return [index + 1, String(word.text || "").trim(), meaning || "中文释义待补充"];
  })];
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `词境-${date}-学习单词.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已导出 ${learnedWords.length} 个 ${shortDate(date)} 学过的单词。`);
}
async function restoreBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    const restoredState = payload?.state || payload;
    if (!isBackupState(restoredState)) throw new Error("这不是可用的词境备份文件");
    if (!window.confirm("恢复备份会替换此设备当前的单词本和学习记录，是否继续？")) return;
    state = restoredState;
    upgradeVoiceSpeedSettings(state.settings);
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    migrateNotebookState();
    migrateMemoryTableState();
    if (storageMode !== "device") hydrateLocalContent();
    selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === state.activeNotebookId))?.id || null;
    question = null; reviewHistory = []; reviewHistoryIndex = null; pausedQuestion = null;
    document.documentElement.dataset.reduceMotion = String(state.settings.reducedMotion);
    applyTheme();
    await persist();
    render();
    scheduleOfflineDictionaryHydration();
    showToast("备份已恢复到此设备。 ");
  } catch (error) { showToast(`恢复失败：${error.message}`); }
}
function touchMemoryPrefs(prefs) {
  const timestamp = new Date().toISOString(); const notebook = activeNotebook();
  prefs.updatedAt = timestamp;
  if (notebook) notebook.updatedAt = timestamp;
}
function setMemoryMode(mode) {
  const prefs = memoryPrefs(); prefs.mode = mode === "dictation" ? "dictation" : "recite"; touchMemoryPrefs(prefs); persist(); render();
}
function setMemoryFilter(filter) {
  const allowed = new Set(["all", ...MEMORY_STEPS.map((step) => step.id), "complete"]);
  const prefs = memoryPrefs(); prefs.filter = allowed.has(filter) ? filter : "all"; touchMemoryPrefs(prefs); memoryVisibleCount = MEMORY_TABLE_PAGE_SIZE; persist({ defer: true }); render();
}
function setMemoryHideAll() {
  const prefs = memoryPrefs(); const mode = memoryModeKey(prefs); const field = mode === "dictation" ? "hideDictationDefinitions" : "hideReciteDefinitions"; const timestamp = new Date().toISOString();
  prefs[field] = !prefs[field]; prefs[`${field}UpdatedAt`] = timestamp; memoryRevealedDefinitionIds(mode).clear(); touchMemoryPrefs(prefs); persist(); render();
}
function toggleMemoryDefinition(wordId) {
  const word = state.words.find((item) => item.id === wordId && item.notebookId === state.activeNotebookId); if (!word) return;
  const prefs = memoryPrefs(); const mode = memoryModeKey(prefs);
  if (memoryHideAll(prefs, mode)) {
    const revealed = memoryRevealedDefinitionIds(mode);
    if (revealed.has(word.id)) revealed.delete(word.id); else revealed.add(word.id);
    render();
    return;
  }
  const current = memoryProgress(word); const nextHidden = !Boolean(current.definitionHiddenByMode?.[mode] ?? current.definitionHidden); const timestamp = new Date().toISOString();
  word.memoryTable = { ...current, definitionHiddenByMode: { ...(current.definitionHiddenByMode || {}), [mode]: nextHidden }, definitionUpdatedAtByMode: { ...(current.definitionUpdatedAtByMode || {}), [mode]: timestamp }, updatedAt: timestamp };
  persist(); render();
}
async function updateMemoryStep(wordId, stepId, completed, mode = memoryPrefs().mode) {
  const word = state.words.find((item) => item.id === wordId && item.notebookId === state.activeNotebookId); if (!word || !MEMORY_STEPS.some((step) => step.id === stepId)) return;
  const current = memoryProgress(word); const priorDirectory = memoryDirectoryKey(word); const timestamp = new Date().toISOString();
  word.memoryTable = { ...current, steps: { ...(current.steps || {}), [stepId]: { completed: Boolean(completed), mode, updatedAt: timestamp } }, updatedAt: timestamp };
  if (completed && memoryPrefs().filter === priorDirectory && memoryDirectoryKey(word) !== priorDirectory) memoryPendingDirectoryExits.set(word.id, priorDirectory);
  if (!completed) memoryPendingDirectoryExits.delete(word.id);
  await persist();
  render();
}
function toggleMemoryStep(wordId, stepId) {
  const word = state.words.find((item) => item.id === wordId && item.notebookId === state.activeNotebookId); if (!word) return;
  void updateMemoryStep(wordId, stepId, !memoryStepComplete(word, stepId), "recite");
}
function checkMemorySpelling(field) {
  if (!field || field.dataset.memorySpellingPending === "true") return;
  const word = state.words.find((item) => item.id === field?.dataset.memorySpelling && item.notebookId === state.activeNotebookId); if (!word) return;
  const entered = String(field.value || "").trim().toLowerCase().replace(/\s+/g, " "); const answer = String(word.text || "").trim().toLowerCase().replace(/\s+/g, " ");
  const feedback = document.querySelector(`[data-memory-feedback="${word.id}"]`);
  if (!entered) { field.removeAttribute("aria-invalid"); if (feedback) feedback.textContent = ""; return; }
  if (entered === answer) {
    const step = memoryFirstIncompleteStep(word);
    if (!step) { if (feedback) feedback.textContent = "已完成"; return; }
    field.dataset.memorySpellingPending = "true";
    field.disabled = true;
    if (feedback) feedback.textContent = "正确";
    void updateMemoryStep(word.id, step.id, true, "dictation");
    return;
  }
  field.setAttribute("aria-invalid", "true"); if (feedback) feedback.textContent = "再试一次";
}
function setActiveNotebook(notebookId) {

  const notebook = state.notebooks.find((item) => item.id === notebookId && !item.archivedAt); if (!notebook) return;
  state.activeNotebookId = notebook.id; selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === notebook.id))?.id || null; learnPage = 0; mistakePage = 0; savedPage = 0; memoryVisibleCount = MEMORY_TABLE_PAGE_SIZE; memorySearch = ""; memoryRevealedDefinitions.clear(); question = null; persist(); render();
}
function createNotebook() {
  const field = document.querySelector("#new-notebook-name"); const name = field?.value.trim(); if (!name) { showToast("请先填写单词本名称。"); field?.focus(); return; }
  const createdAt = new Date().toISOString(); const notebook = { id: id("notebook"), name, createdAt, archivedAt: null, memoryTable: defaultMemoryTable({ createdAt }) }; state.notebooks.push(notebook); setActiveNotebook(notebook.id); showToast(`已新建「${name}」。`);
}
function archiveNotebook(notebookId) {
  const notebook = state.notebooks.find((item) => item.id === notebookId && !item.archivedAt); if (!notebook) return;
  if (!window.confirm(`归档「${notebook.name}」？词表和学习、复习记录都会保留，可随时恢复。`)) return;
  notebook.archivedAt = new Date().toISOString(); let next = state.notebooks.find((item) => !item.archivedAt);
  if (!next) { const createdAt = new Date().toISOString(); next = { id: id("notebook"), name: "新的单词本", createdAt, archivedAt: null, memoryTable: defaultMemoryTable({ createdAt }) }; state.notebooks.push(next); }
  setActiveNotebook(next.id); showToast(`已归档「${notebook.name}」，记录已保留。`);
}
function deleteNotebook(notebookId) {
  const notebook = state.notebooks.find((item) => item.id === notebookId); if (!notebook) return;
  if (!window.confirm(`彻底删除「${notebook.name}」的所有词和学习、复习记录？此操作不可恢复。`)) return;
  const wordIds = new Set(state.words.filter((word) => word.notebookId === notebook.id).map((word) => word.id));
  state.words = state.words.filter((word) => word.notebookId !== notebook.id); state.batches = state.batches.filter((batch) => batch.notebookId !== notebook.id); state.logs = state.logs.filter((log) => !wordIds.has(log.wordId)); state.notebooks = state.notebooks.filter((item) => item.id !== notebook.id);
  let next = state.notebooks.find((item) => !item.archivedAt); if (!next) { const createdAt = new Date().toISOString(); next = { id: id("notebook"), name: "新的单词本", createdAt, archivedAt: null, memoryTable: defaultMemoryTable({ createdAt }) }; state.notebooks.push(next); }
  setActiveNotebook(next.id); showToast("单词本及其学习、复习记录已彻底删除。");
}
async function deleteMasteredWord(wordId) {
  const word = state.words.find((item) => item.id === wordId && item.notebookId === state.activeNotebookId && item.stage === "mastered");
  if (!word) return;
  if (!window.confirm(`从当前词库删除「${word.text}」？它的学习与复习记录也会一并删除。`)) return;
  state.words = state.words.filter((item) => item.id !== wordId);
  state.logs = state.logs.filter((log) => log.wordId !== wordId);
  state.batches = state.batches.map((batch) => ({ ...batch, wordIds: batch.wordIds.filter((idValue) => idValue !== wordId) })).filter((batch) => batch.wordIds.length);
  selectedBatchId = lastItem(state.batches.filter((batch) => batch.notebookId === state.activeNotebookId))?.id || null;
  question = null; await persist(); showToast(`已从词库删除「${word.text}」。`); render();
}
function restoreNotebook(notebookId) { const notebook = state.notebooks.find((item) => item.id === notebookId && item.archivedAt); if (!notebook) return; notebook.archivedAt = null; setActiveNotebook(notebook.id); showToast(`已恢复「${notebook.name}」。`); }
function fileAsBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error || new Error("文件读取失败")); reader.onload = () => resolve(lastItem(String(reader.result).split(","))); reader.readAsDataURL(file); }); }
async function importFile(file) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase(); if (!extension) { showToast("请选择 TXT、PDF、Word 或 XLSX 文件。"); return; }
  if (file.size > 10 * 1024 * 1024) { showToast("文件请控制在 10 MB 以内。导入只读取英文单词。 "); return; }
  try {
    showToast("正在本地读取文件…");
    const raw = storageMode === "device"
      ? await extractFileOnDevice(file, extension)
      : extension === ".txt" ? await file.text() : (await (async () => { const response = await apiFetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, file: await fileAsBase64(file) }) }); if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error || "文件解析失败"); } return (await response.json()).text; })());
    await importWords(raw, file.name);
  } catch (error) { showToast(`导入失败：${error.message}`); }
}
async function clearTodayProgress(kind) {
  const today = beijingDateKey();
  if (kind === "learning") {
    const affected = studyWords().filter((word) => learnedDateKey(word) === today);
    if (!affected.length || !window.confirm("清空今日学习记录并让这些词重新进入学习吗？")) return;
    affected.forEach((word) => { word.learningSeen = false; word.learnedAt = null; word.learningPlanDate = null; if (word.stage === "sameDay") { word.stage = "learning"; word.dueAt = null; } });
  } else {
    const todayLogs = activeLogs().filter((log) => beijingDateKey(log.reviewedAt) === today);
    if (!todayLogs.length || !window.confirm("清空今日复习记录并将这些词重新安排为待复习吗？")) return;
    const ids = new Set(todayLogs.map((log) => log.wordId));
    state.logs = state.logs.filter((log) => !todayLogs.includes(log));
    studyWords().filter((word) => ids.has(word.id)).forEach((word) => { if (word.stage !== "learning") { word.stage = "review"; word.dueAt = new Date().toISOString(); word.masteredCycles = 0; word.masterySeenSceneIds = []; word.masteryCheckDueAt = null; } });
  }
  question = null; await persist(); render(); showToast(kind === "learning" ? "今日学习记录已清空" : "今日复习记录已清空");
}

async function resetAllLearningProgress() {
  if (!window.confirm("清空所有单词的学习与复习记录，并同步清空云端的相同记录？词本、单词内容和设置会保留。")) return;
  clearAllLearningProgress(new Date().toISOString());
  if (state.sync?.enabled) syncConfig().dirty = true;
  question = null;
  reviewHistory = [];
  reviewHistoryIndex = null;
  pausedQuestion = null;
  await persist({ skipCloud: true, silent: true });
  render();
  if (canUseCloudSync()) { setCloudSyncStatus("学习记录已重置 · 将在 4 小时内自动同步"); showToast("学习记录已在本机清空；将在下次自动同步时同步到云端。" ); }
  else showToast("学习记录已清空；以后启用云端同步时会同步这次重置。" );
}

function retrievability(stability, elapsedDays) { const factor = Math.pow(0.9, -1 / FSRS6[20]) - 1; return Math.pow(1 + factor * elapsedDays / Math.max(stability, .1), -FSRS6[20]); }
function intervalFor(stability) { const retention = Math.max(.7, Math.min(.97, Number(state.settings.targetRetention))); const factor = Math.pow(0.9, -1 / FSRS6[20]) - 1; return Math.max(1, stability / factor * (Math.pow(retention, -1 / FSRS6[20]) - 1)); }
function memoryState(card, reference = now()) {
  const hasReview = Boolean(card.lastReviewAt && Number.isFinite(Number(card.stability)));
  const elapsed = hasReview ? daysBetween(card.lastReviewAt, reference) : null;
  return { hasReview, elapsed, retrievability: hasReview ? retrievability(Number(card.stability), elapsed) : null, stability: Number(card.stability) || null, difficulty: Number(card.difficulty) || null, reviewCount: Number(card.reviewCount) || 0, lapses: Number(card.lapses) || 0 };
}
function formatInterval(days) {
  if (!Number.isFinite(days)) return "首次巩固";
  const minutes = Math.max(1, Math.round(days * 1440));
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.max(1, Math.round((minutes / 1440) * 10) / 10)} 天`;
}
function formatReviewDate(iso) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); }
function initialDifficulty(grade) { return Math.max(1, Math.min(10, FSRS6[4] - Math.exp(FSRS6[5] * (grade - 1)) + 1)); }
function nextDifficulty(difficulty, grade) { const delta = -FSRS6[6] * (grade - 3); const damped = difficulty + delta * (10 - difficulty) / 9; const target = initialDifficulty(4); return Math.max(1, Math.min(10, FSRS6[7] * target + (1 - FSRS6[7]) * damped)); }
function schedule(card, grade) {
  const reviewedAt = now(); let stability; let difficulty;
  if (!card.stability) { stability = FSRS6[grade - 1]; difficulty = initialDifficulty(grade); }
  else {
    const elapsed = daysBetween(card.lastReviewAt, reviewedAt);
    const recall = retrievability(card.stability, elapsed);
    const priorDifficulty = Number.isFinite(Number(card.difficulty)) ? Number(card.difficulty) : initialDifficulty(3);
    difficulty = nextDifficulty(priorDifficulty, grade);
    if (grade === 1) stability = FSRS6[11] * Math.pow(difficulty, -FSRS6[12]) * (Math.pow(card.stability + 1, FSRS6[13]) - 1) * Math.exp(FSRS6[14] * (1 - recall));
    else if (elapsed < 1) stability = card.stability * Math.exp(FSRS6[17] * (grade - 3 + FSRS6[18])) * Math.pow(card.stability, -FSRS6[19]);
    else {
      const bonus = grade === 2 ? FSRS6[15] : grade === 4 ? FSRS6[16] : 1;
      stability = card.stability * (Math.exp(FSRS6[8]) * (11 - difficulty) * Math.pow(card.stability, -FSRS6[9]) * (Math.exp(FSRS6[10] * (1 - recall)) - 1) * bonus + 1);
    }
  }
  const interval = grade === 1 ? 10 / 1440 : intervalFor(stability);
  card.stability = Math.max(.1, stability);
  card.difficulty = difficulty;
  card.lastReviewAt = reviewedAt.toISOString();
  card.dueAt = hoursFromNow(interval * 24);
  card.reviewCount += 1;
  card.lapses += grade === 1 ? 1 : 0;
  card.stage = "review";
  return { interval, stability: card.stability, difficulty, reviewedAt: card.lastReviewAt, nextDueAt: card.dueAt, targetRetention: Number(state.settings.targetRetention) };
}
async function completeLearning() {
  const cards = dailyStudyWords().filter((word) => word.stage === "learning");
  if (!cards.length) { navigate("review"); return; }
  const unseen = cards.filter((word) => !word.learningSeen);
  if (unseen.length) { showToast(`还有 ${unseen.length} 个词未学习，请先完成学习。`); return; }
  const sameDayIds = new Set(shuffle(cards).slice(0, Math.min(GENTLE_SAME_DAY_RECALL_LIMIT, cards.length)).map((word) => word.id));
  cards.forEach((word) => {
    if (sameDayIds.has(word.id)) {
      word.stage = "sameDay";
      word.dueAt = new Date().toISOString();
    } else {
      word.stage = "review";
      word.dueAt = hoursFromNow(18);
    }
  });
  const plannedIds = new Set(cards.map((word) => word.id));
  state.batches.filter((batch) => batch.notebookId === state.activeNotebookId && batch.wordIds.some((wordId) => plannedIds.has(wordId))).forEach((batch) => { batch.status = "reinforcing"; });
  await persist();
  showToast(`今天只随机巩固 ${sameDayIds.size} 个词，其余会在明天后自然出现。`);
  navigate("review");
}async function choose(option) {
  if (!question || question.answered || question.historical) return;
  const card = state.words.find((word) => word.id === question.wordId); if (!card) return;
  speak(option, "word"); question.selected = option; question.answered = true;
  const correct = option === question.answer; const grade = correct ? (question.hintUsed ? 2 : 3) : 1;
  const responseTimeMs = Math.max(0, Date.now() - Number(question.startedAt || Date.now())); const before = memoryState(card);
  const result = schedule(card, grade);
  const sceneIds = verifiedExampleContexts(card).map((item) => item.sceneId);
  const priorCycles = Number(card.masteredCycles) || 0;
  if (correct && sceneIds.length) {
    const seen = new Set(card.masterySeenSceneIds || []); seen.add(question.sceneId);
    card.masterySeenSceneIds = [...seen];
    if (sceneIds.every((sceneId) => seen.has(sceneId))) {
      if (priorCycles >= 1) { card.masteredCycles = 2; card.masterySeenSceneIds = []; card.masteryCheckDueAt = null; card.stage = "mastered"; card.dueAt = null; }
      else { card.masteredCycles = 1; card.masterySeenSceneIds = []; card.masteryCheckDueAt = hoursFromNow(14 * 24); card.stage = "mastered"; card.dueAt = null; }
    } else if (priorCycles === 1) { card.stage = "mastered"; card.masteryCheckDueAt = hoursFromNow(21 * 24); card.dueAt = null; }
  } else if (!correct && priorCycles === 1) {
    card.masteredCycles = 0; card.masterySeenSceneIds = []; card.masteryCheckDueAt = null; card.stage = "review"; card.dueAt = hoursFromNow(24);
  }
  question.memoryResult = { before, interval: result.interval, nextDueAt: card.masteryCheckDueAt || card.dueAt || result.nextDueAt, targetRetention: result.targetRetention, stability: result.stability, difficulty: result.difficulty };
  reviewHistory.push(cloneValue(question)); reviewHistoryIndex = null; pausedQuestion = null;
  const sentenceKey = normalizedSentenceKey(question.fullSentence || question.sentence);
  card.lastSenseAttempt = { senseId: question.senseId || "definition", sentenceKey, correct, targetForm: question.answer || card.text, reviewedAt: result.reviewedAt };
  card.contexts.push({ id: id("context"), sceneId: question.sceneId, senseId: question.senseId || "definition", senseKey: question.contextSense || wordProfile(card).currentSense, targetForm: question.answer || card.text, zh: question.zh, sentence: question.fullSentence || question.sentence, usedAt: result.reviewedAt });
  const latestContext = lastItem(card.contexts);
  state.logs.push({ id: id("review"), wordId: card.id, contextId: latestContext.id, senseId: latestContext.senseId, senseKey: latestContext.senseKey, targetForm: latestContext.targetForm, correct, hintUsed: question.hintUsed, grade, responseTimeMs, reviewedAt: result.reviewedAt, nextDueAt: card.dueAt, stability: result.stability, difficulty: result.difficulty, interval: result.interval, retentionBefore: before.retrievability });
  await persist(); render();
}
function reveal(useHint) { if (!question || question.answered) return; question.showingOptions = true; question.hintUsed = useHint; render(); }
function previousQuestion() {
  if (!reviewHistory.length) { showToast("还没有可回看的上一题。"); return; }
  if (!question?.historical) pausedQuestion = question;
  reviewHistoryIndex = reviewHistoryIndex === null ? reviewHistory.length - 1 : Math.max(0, reviewHistoryIndex - 1);
  question = { ...cloneValue(reviewHistory[reviewHistoryIndex]), historical: true }; render();
}
function nextQuestion() {
  if (question?.historical) {
    if (reviewHistoryIndex < reviewHistory.length - 1) { reviewHistoryIndex += 1; question = { ...cloneValue(reviewHistory[reviewHistoryIndex]), historical: true }; }
    else { question = pausedQuestion; pausedQuestion = null; reviewHistoryIndex = null; }
    render(); return;
  }
  question = null; render();
}

function voicePreference(voice) {
  const name = String(voice.name || "").toLowerCase();
  if (/samantha|ava|allison|zoe|nicky|karen|siri|daniel|moira|rishi|tessa|serena|alex/.test(name)) return 0;
  if (/fred|grandma|grandpa|zarvox|bells|boing|bad news|good news|whisper/.test(name)) return 3;
  return 1;
}
function englishVoices() {
  if (!("speechSynthesis" in window)) return [];
  const voices = speechSynthesis.getVoices().filter((voice) => /^en(?:[-_]|$)/i.test(String(voice.lang || "")));
  return voices.sort((left, right) => {
    const leftUs = /^en[-_]US$/i.test(left.lang) ? 0 : 1;
    const rightUs = /^en[-_]US$/i.test(right.lang) ? 0 : 1;
    return leftUs - rightUs || voicePreference(left) - voicePreference(right) || left.name.localeCompare(right.name);
  });
}
function selectedVoice() { const voices = englishVoices(); return voices.find((voice) => voice.voiceURI === state.settings.voiceURI) || voices[0] || null; }
let speechRequestId = 0;
let speechEnginePrimed = false;
const pointerStartedSpeechButtons = new WeakSet();
function primeSpeechEngine() {
  if (speechEnginePrimed || !("speechSynthesis" in window)) return;
  speechEnginePrimed = true;
  try { speechSynthesis.getVoices(); speechSynthesis.resume(); } catch { /* Voice engines vary by browser. */ }
}
function speak(text, type = "sentence") {
  const phrase = String(text || "").replace(/\s+/g, " ").trim();
  if (!phrase) return;
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) { showToast("当前浏览器不支持朗读。"); return; }
  const voice = selectedVoice(); const requestId = ++speechRequestId;
  const defaultRate = type === "word" ? DEFAULT_SETTINGS.wordRate : DEFAULT_SETTINGS.sentenceRate;
  const requestedRate = Number(type === "word" ? state.settings.wordRate : state.settings.sentenceRate);
  const rate = Math.min(2, Math.max(0.8, Number.isFinite(requestedRate) ? requestedRate : defaultRate));
  try { speechSynthesis.cancel(); speechSynthesis.resume(); } catch { /* Continue with the browser default speech queue. */ }
  const utterance = new SpeechSynthesisUtterance(phrase);
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang || "en-US"; }
  else utterance.lang = "en-US";
  const naturalSentence = type === "sentence" && state.settings.sentenceVoiceEngine === "natural";
  utterance.rate = naturalSentence ? Math.min(rate, 0.96) : rate; utterance.pitch = naturalSentence ? 0.92 : 1; utterance.volume = 1;
  utterance.onerror = (event) => {
    if (requestId !== speechRequestId || event.error === "canceled" || event.error === "interrupted") return;
    if (event.error === "not-allowed") showToast("请先轻点页面，再试听发音。");
  };
  // Clear any earlier utterance and actively resume the engine so a direct tap
  // starts the requested word or sentence without waiting for a stale queue.
  speechSynthesis.speak(utterance);
  try { speechSynthesis.resume(); } catch { /* The initial speak call is sufficient on older browsers. */ }
}
function markLearningSeen(word) {
  if (word.learningSeen) return; word.learningSeen = true; word.learnedAt = now().toISOString(); persist({ defer: true });
  const status = document.querySelector(`[data-learning-status="${word.id}"]`); if (status) { status.textContent = "已学习"; status.closest(".learning-word-nav")?.classList.add("is-seen"); }
  if (!learningPlanWordIds.has(word.id)) return;
  learningPlanSeenCount += 1;
  const summary = document.querySelector("[data-learning-summary]"); if (summary) summary.innerHTML = `已学习 <strong>${learningPlanSeenCount}</strong> / ${learningPlanTotal}`;
  const dailyProgress = document.querySelector(".daily-progress-line"); if (dailyProgress) dailyProgress.innerHTML = `今日已学习 <strong>${learningPlanSeenCount} / ${learningPlanTotal}</strong> 个单词`;
}
function sentenceFor(word) { const base = wordData(word); return word.sentence || base.sentence || ""; }
function showTranslation(wordId, button) { const panel = document.querySelector(`[data-translation-panel="${wordId}"]`); if (!panel) return; const shown = panel.classList.toggle("is-visible"); button.textContent = shown ? "收起句子意思" : "查看句子意思"; const word = state.words.find((item) => item.id === wordId); const sentence = word?.sentence || wordData(word || {}).sentence; if (shown && sentence) speak(sentence, "sentence"); }
function partOfSpeechTokens(value) {
  const aliases = { a: "adj", ad: "adv", vi: "v", vt: "v" };
  return [...new Set((String(value || "").match(/\b(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\./gi) || []).map((tag) => `${aliases[tag.slice(0, -1).toLowerCase()] || tag.slice(0, -1).toLowerCase()}.`))];
}
function meaningTokens(value) {
  const withoutPartOfSpeech = String(value || "").replace(/^(?:(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.\s*(?:\/|,|;|、)?\s*)+/i, "");
  return withoutPartOfSpeech.split(/[；;，,、]/).map((item) => item.trim()).filter(Boolean).slice(0, 14);
}
function definitionMarkup(partOfSpeech, sense) {
  return `<p class="popover-current-sense"><span>${escapeHtml(friendlyPartOfSpeech(partOfSpeech))}</span>${escapeHtml(friendlySense(sense) || "中文释义待补充")}</p>`;
}
function popover(wordText, anchor) {
  document.querySelector(".word-popover")?.remove();
  const word = activeWords().find((item) => item.text.toLowerCase() === wordText.toLowerCase());
  if (!word) return;
  const box = anchor.getBoundingClientRect();
  const element = document.createElement("aside");
  element.className = "word-popover";
  const sentenceSense = friendlySense(word.sentenceSense || word.currentSense || "");
  const other = otherDefinitionsFor(word, sentenceSense);
  element.innerHTML = `<button class="speaker" data-speak-word="${word.id}" aria-label="朗读 ${escapeHtml(word.text)}">${SPEAKER_ICON}</button><h3>${escapeHtml(word.text)}</h3><p class="word-phonetic">${escapeHtml(word.phonetic || "音标待补充")}</p>${sentenceSense ? `<div class="sentence-sense"><small>本句释义</small>${definitionMarkup(word.sentencePartOfSpeech || word.partOfSpeech, sentenceSense)}</div>` : ""}<div class="definition-group-list">${other.map((item) => definitionMarkup(item.partOfSpeech, item.sense)).join("")}</div>`;
  document.body.append(element);
  const padding = 12;
  const gap = 10;
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  let left;
  let top;
  if (mobile) {
    // Avoid reading offsetHeight on mobile: a forced full-page layout here made
    // a second word tap visibly pause on long learning pages.
    const width = Math.min(350, window.innerWidth - padding * 2);
    left = Math.min(window.innerWidth - width - padding, Math.max(padding, box.left));
    top = box.bottom + window.scrollY + gap;
    element.style.position = "absolute";
  } else {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    left = Math.min(window.innerWidth - width - padding, Math.max(padding, box.left));
    top = box.bottom + gap;
    if (top + height > window.innerHeight - padding) top = Math.max(padding, box.top - height - gap);
  }
  element.style.setProperty("right", "auto", "important");
  element.style.setProperty("bottom", "auto", "important");
  element.style.setProperty("left", `${left}px`, "important");
  element.style.setProperty("top", `${top}px`, "important");
  markLearningSeen(word);
  // Opening a word is a direct user gesture, so it can safely start speech on
  // both desktop browsers and iPhone Safari.
  speak(word.text, "word");
  setTimeout(() => document.addEventListener("pointerdown", function dismiss(event) {
    if (!element.contains(event.target) && event.target !== anchor) {
      element.remove();
      document.removeEventListener("pointerdown", dismiss);
    }
  }), 0);
}
document.addEventListener("scroll", () => {
  // On iPhone the popover is positioned in the document, so removing it during
  // momentum scrolling forces a repaint and can flash the entire page. Keep it
  // on mobile; it simply scrolls out of view and is replaced on the next word tap.
  if (!window.matchMedia("(max-width: 700px)").matches) document.querySelector(".word-popover")?.remove();
}, true);

function triggerSpeechButtonAction(button) {
  if (button.dataset.speakWord) { const word = state.words.find((item) => item.id === button.dataset.speakWord); if (word) speak(word.text, "word"); return Boolean(word); }
  if (button.dataset.speakText) { speak(button.dataset.speakText, "word"); return true; }
  if (button.dataset.speakSentence) { speak(button.dataset.speakSentence, "sentence"); return true; }
  if (button.dataset.popoverWord) { popover(button.dataset.popoverWord, button); return true; }
  if (button.dataset.showWord) { const word = state.words.find((item) => item.id === button.dataset.showWord); if (word) popover(word.text, button); return Boolean(word); }
  if (button.dataset.showTranslation) { showTranslation(button.dataset.showTranslation, button); return true; }
  if (button.dataset.testVoice !== undefined) { speak("A quiet morning begins with a new word.", "sentence"); return true; }
  return false;
}
document.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
  primeSpeechEngine();
  const button = event.target.closest("button"); if (!button) return;
  if (triggerSpeechButtonAction(button)) pointerStartedSpeechButtons.add(button);
}, true);

document.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.dataset.nav) navigate(button.dataset.nav);
  if (button.dataset.go) navigate(button.dataset.go);
  if (button.dataset.toggleTheme !== undefined) { state.settings.darkMode = !state.settings.darkMode; applyTheme(); persist(); renderNav(); }
  if (button.dataset.memoryMode) setMemoryMode(button.dataset.memoryMode);
  if (button.dataset.memoryFilter) setMemoryFilter(button.dataset.memoryFilter);
  if (button.dataset.memoryHideAll !== undefined) setMemoryHideAll();
  if (button.dataset.memoryToggleDefinition) toggleMemoryDefinition(button.dataset.memoryToggleDefinition);
  if (button.dataset.memoryStep && button.dataset.memoryWord) toggleMemoryStep(button.dataset.memoryWord, button.dataset.memoryStep);
  if (button.dataset.memoryMore !== undefined) { memoryVisibleCount += MEMORY_TABLE_PAGE_SIZE; render(); }

  if (button.dataset.import !== undefined) importWords(document.querySelector("#word-input")?.value || "");
  if (button.dataset.openFile !== undefined) document.querySelector("#txt-file")?.click();
  if (button.dataset.createNotebook !== undefined) createNotebook();
  if (button.dataset.archiveNotebook) archiveNotebook(button.dataset.archiveNotebook);
  if (button.dataset.deleteNotebook) deleteNotebook(button.dataset.deleteNotebook);
  if (button.dataset.restoreNotebook) restoreNotebook(button.dataset.restoreNotebook);
  if (button.dataset.toggleWordbookPanel !== undefined) { wordbookPanelExpanded = !wordbookPanelExpanded; render(); }
  if (button.dataset.toggleSavedWords !== undefined) { savedWordsExpanded = !savedWordsExpanded; render(); }
  if (button.dataset.toggleMasteredWords !== undefined) { masteredWordsExpanded = !masteredWordsExpanded; render(); }
  if (button.dataset.mistakePage !== undefined) { mistakePage = Math.max(0, Number(button.dataset.mistakePage)); render(); }
  if (button.dataset.savedPage !== undefined) { savedPage = Math.max(0, Number(button.dataset.savedPage)); render(); }
  if (button.dataset.masteredPage !== undefined) { masteredPage = Math.max(0, Number(button.dataset.masteredPage)); render(); }
  if (button.dataset.deleteMasteredWord) deleteMasteredWord(button.dataset.deleteMasteredWord);
  if (button.dataset.clearTodayLearning !== undefined) clearTodayProgress("learning");
  if (button.dataset.clearTodayReview !== undefined) clearTodayProgress("review");
  if (button.dataset.historyMonth !== undefined) {
    const studyDays = studyHistoryDays(); const earliest = monthKey(lastItem(studyDays)?.dateKey || beijingDateKey()); const latest = monthKey(); const candidate = shiftMonth(historyCalendarMonth || latest, Number(button.dataset.historyMonth));
    if (candidate >= earliest && candidate <= latest) { historyCalendarMonth = candidate; render(); }
  }
  if (button.dataset.scrollSetting !== undefined) document.querySelector(`#setting-${button.dataset.scrollSetting}`)?.scrollIntoView({ behavior: state.settings.reducedMotion ? "auto" : "smooth", block: "start" });
  if (button.dataset.selectBatch) { selectedBatchId = button.dataset.selectBatch; learnPage = 0; revealedTranslations = new Set(); render(); }
  if (button.dataset.learnPage !== undefined) { learnPage = Number(button.dataset.learnPage); render(); window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? "auto" : "smooth" }); }
  if (button.dataset.jumpWord) { document.querySelector(`#learning-word-${button.dataset.jumpWord}`)?.scrollIntoView({ behavior: state.settings.reducedMotion ? "auto" : "smooth", block: "center" }); }
  if (button.dataset.completeLearning !== undefined) completeLearning();
  if (button.dataset.reveal !== undefined) reveal(button.dataset.reveal === "true");
  if (button.dataset.choice) choose(button.dataset.choice);
  if (button.dataset.nextQuestion !== undefined) nextQuestion();
  if (button.dataset.previousQuestion !== undefined) previousQuestion();
  if (!pointerStartedSpeechButtons.delete(button)) triggerSpeechButtonAction(button);
  if (button.dataset.retryExamples) { const word = state.words.find((item) => item.id === button.dataset.retryExamples); if (word) retryAiContexts([word], currentView); }

  if (button.dataset.exportBackup !== undefined) exportBackup();
  if (button.dataset.exportLearnedWords !== undefined) exportLearnedWords(document.querySelector('[data-export-learning-date]')?.value);
  if (button.dataset.generateSyncKey !== undefined) {
    const field = document.querySelector("[data-cloud-sync-key]");
    if (field && SYNC) { field.value = SYNC.createSecret(); field.focus(); field.select(); showToast("已生成同步密钥。请保存它，并在三台设备输入完全相同的密钥。"); }
  }
  if (button.dataset.enableSync !== undefined) void enableCloudSync(document.querySelector("[data-cloud-sync-key]")?.value);
  if (button.dataset.recoverHomeScreen !== undefined) void recoverHomeScreenState(document.querySelector("[data-home-screen-sync-key]")?.value);
  if (button.dataset.dismissHomeScreenRecovery !== undefined) dismissHomeScreenRecovery();
  if (button.dataset.openHomeScreenRecovery !== undefined) openHomeScreenRecovery();
  if (button.dataset.startupRecover !== undefined) { state = makeInitialState(); storageMode = "device"; homeScreenRecoveryPending = true; homeScreenRecoveryError = ""; currentView = "home"; render(); }
  if (button.dataset.copySyncKey !== undefined) void copyCloudSyncKey();
  if (button.dataset.syncNow !== undefined) void syncCloudState({ manual: true });
  if (button.dataset.refreshApp !== undefined) window.location.assign("./refresh.html");
  if (button.dataset.resetAllLearning !== undefined) void resetAllLearningProgress();
  if (button.dataset.disableSync !== undefined) void disableCloudSync();
});
document.addEventListener("change", (event) => {
  if (event.target.dataset.wordDefinition) updateWordDefinition(event.target.dataset.wordDefinition, event.target.value);
  if (event.target.dataset.memorySpelling) checkMemorySpelling(event.target);
  if (event.target.dataset.fileInput && event.target.files?.[0]) { const file = event.target.files[0]; event.target.value = ""; importFile(file); }
  if (event.target.dataset.backupInput && event.target.files?.[0]) { const file = event.target.files[0]; event.target.value = ""; restoreBackup(file); }
  if (event.target.dataset.activeNotebook) setActiveNotebook(event.target.value);
  if (event.target.dataset.setting) { state.settings[event.target.dataset.setting] = event.target.value; persist(); }
  if (event.target.dataset.numberSetting) {
    const key = event.target.dataset.numberSetting; const limits = { dailyNewTarget: [1, 500], dailyReviewTarget: [1, 500], reviewGate: [1, 1000] }[key];
    let value = Number(event.target.value);
    if (!Number.isFinite(value)) { event.target.value = state.settings[key]; return; }
    if (limits) value = Math.min(limits[1], Math.max(limits[0], Math.round(value)));
    state.settings[key] = value; event.target.value = value; persist();
    if (limits && currentView === "settings") { render(); showToast("每日计划已更新；今天已安排的词会保留。"); }
  }
  if (event.target.dataset.checkboxSetting) { const key = event.target.dataset.checkboxSetting; state.settings[key] = event.target.checked; if (key === "reducedMotion") document.documentElement.dataset.reduceMotion = String(event.target.checked); if (key === "darkMode") { applyTheme(); renderNav(); } persist(); }
});
document.addEventListener("input", (event) => {
  if (event.target.dataset.memorySearch !== undefined) {
    const value = event.target.value; memorySearch = value; memoryVisibleCount = MEMORY_TABLE_PAGE_SIZE;
    if (currentView === "memory") {
      renderMemory();
      const field = document.querySelector("[data-memory-search]"); field?.focus(); field?.setSelectionRange(value.length, value.length);
    }
  }
  if (event.target.dataset.memorySpelling) { event.target.removeAttribute("aria-invalid"); const feedback = document.querySelector(`[data-memory-feedback="${event.target.dataset.memorySpelling}"]`); if (feedback) feedback.textContent = ""; }
  if (event.target.dataset.librarySearch) {
    const value = event.target.value; librarySearch = value; mistakePage = 0; savedPage = 0; masteredPage = 0;
    if (currentView === "words") {
      renderWords();
      const field = document.querySelector('[data-library-search="all"]');
      field?.focus(); field?.setSelectionRange(value.length, value.length);
    }
  }
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target.matches("[data-memory-spelling]") && event.key === "Enter") { event.preventDefault(); checkMemorySpelling(target); return; }
  if (target.matches("input, textarea, select")) return;
  if (currentView !== "review" || !question) return;
  if (event.code === "Space" && question.sentence) { event.preventDefault(); speak(question.fullSentence || question.sentence.replace("____", question.answer || ""), "sentence"); }
  if (question.showingOptions && !question.answered && /^[1-4]$/.test(event.key)) { const option = question.options[Number(event.key) - 1]; if (option) choose(option); }
  if (question.answered && event.key === "Enter") nextQuestion();
});
window.addEventListener("hashchange", () => { const view = window.location.hash.slice(1); if (["home", "words", "learn", "review", "memory", "settings"].includes(view) && currentView !== view) { currentView = view; question = null; render(); } });
window.addEventListener("online", () => { if (cloudSyncIsDue()) void syncCloudState({ automatic: true }); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && cloudSyncIsDue()) void syncCloudState({ automatic: true }); });
if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener("voiceschanged", () => { if (currentView === "settings") render(); });
}

currentView = ["home", "words", "learn", "review", "memory", "settings"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "home";
async function startApplication() {
  try {
    await load();
    await installBundledWordbook();
    if (currentView === "learn") return preloadAiContexts(dailyStudyWords(), currentView);
    if (currentView === "review") return preloadAiContexts(queue(), currentView);
  } catch (error) {
    console.error("wordscape startup failed", error);
    APP.innerHTML = `<section class="done-state startup-recovery"><p class="eyebrow">启动恢复</p><h2>词境没有完全打开。</h2><p>你的本机词本与学习记录没有被删除。先修复本机界面缓存；若仍无法进入，再恢复已有词本。</p><div class="action-row"><a class="primary" href="./refresh.html">修复本机缓存</a><button class="secondary" data-startup-recover>恢复已有词本</button></div><p class="note">“修复本机缓存”只移除旧界面文件，不会删除词本。</p></section>`;
  }
}
startApplication();
