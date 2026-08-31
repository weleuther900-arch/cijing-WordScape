const VOICE_ID = "af_bella";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
const MODEL_REVISION = "dd4401a9add81ac692d20e240d22ec9dda82cc29";
const READY_KEY = "wordscape.offlineVoice.kokoro.v1";
const MAX_WORD_LENGTH = 80;
let enginePromise = null;
let connectionPromise = null;

function isSupported() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" && Boolean(window.AudioContext || window.webkitAudioContext) && typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
}
function isReady() {
  try { return localStorage.getItem(READY_KEY) === MODEL_REVISION; } catch { return false; }
}
function markReady(ready) {
  try { if (ready) localStorage.setItem(READY_KEY, MODEL_REVISION); else localStorage.removeItem(READY_KEY); } catch { /* The downloaded model remains usable for this session. */ }
}
async function engine(context) {
  if (!enginePromise) {
    const { HeadTTS } = await import("./vendor/offline-tts/headtts/modules/headtts.mjs");
    enginePromise = new HeadTTS({
      endpoints: ["wasm"],
      audioCtx: context,
      workerModule: new URL("./vendor/offline-tts/headtts/modules/worker-tts.mjs", import.meta.url).href,
      transformersModule: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.min.js",
      model: MODEL_ID,
      modelRevision: MODEL_REVISION,
      dtypeWasm: "q8",
      languages: ["en-us"],
      dictionaryURL: new URL("./vendor/offline-tts/headtts/dictionaries", import.meta.url).href,
      voiceURL: `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/voices`,
      voices: [VOICE_ID],
      defaultVoice: VOICE_ID,
      defaultLanguage: "en-us",
      defaultAudioEncoding: "wav"
    });
  }
  return enginePromise;
}
async function connected(context, onProgress) {
  if (!isSupported()) throw new Error("当前浏览器不支持离线统一声音");
  const tts = await engine(context);
  if (!tts.isConnected) {
    if (!connectionPromise) {
      connectionPromise = tts.connect(null, (event) => onProgress?.({ loaded: event.loaded || 0, total: event.total || 0 })).finally(() => { connectionPromise = null; });
    }
    await connectionPromise;
  }
  await tts.setup({ voice: VOICE_ID, language: "en-us", speed: 1, audioEncoding: "wav" });
  return tts;
}
function firstAudio(messages) {
  const message = Array.isArray(messages) ? messages.find((item) => item?.type === "audio" && item?.data?.audio) : null;
  if (!message) throw new Error("离线声音没有生成音频");
  return message.data.audio;
}
export async function status() {
  return { supported: isSupported(), ready: isReady() };
}
export async function download(onProgress, context) {
  const tts = await connected(context, onProgress);
  const audio = firstAudio(await tts.synthesize({ input: "word", audioEncoding: "wav" }));
  markReady(true);
  return { ...(await status()), audio };
}
export async function remove() {
  try { const tts = await enginePromise; tts?.ww?.terminate(); } catch { /* The browser may already have ended the worker. */ }
  enginePromise = null;
  connectionPromise = null;
  markReady(false);
  try { if ("caches" in window) await caches.delete("transformers-cache"); } catch { /* Cache cleanup is best effort. */ }
}
export async function synthesize(text, context, speed = 1) {
  const phrase = String(text || "").replace(/\s+/g, " ").trim();
  if (!phrase || phrase.length > MAX_WORD_LENGTH) throw new Error("离线统一声音只用于朗读单词");
  if (!isReady()) { const error = new Error("离线统一声音尚未准备"); error.code = "VOICE_NOT_READY"; throw error; }
  const speakingSpeed = Math.min(1.5, Math.max(0.8, Number(speed) || 1));
  const tts = await connected(context);
  const audio = firstAudio(await tts.synthesize({ input: phrase, speed: speakingSpeed, audioEncoding: "wav" }));
  markReady(true);
  return audio;
}