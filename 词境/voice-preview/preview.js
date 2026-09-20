"use strict";

const voiceSelect = document.querySelector("#voice");
const wordInput = document.querySelector("#word");
const speakButton = document.querySelector("#speak");
const status = document.querySelector("#status");
const STORAGE_KEY = "wordscape.voicePreview.voiceURI";
let voices = [];
let activeRequest = 0;

function englishVoices() {
  return speechSynthesis.getVoices()
    .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang || ""))
    .sort((a, b) => `${a.lang} ${a.name}`.localeCompare(`${b.lang} ${b.name}`));
}
function renderVoices() {
  voices = englishVoices();
  const saved = localStorage.getItem(STORAGE_KEY) || "";
  voiceSelect.replaceChildren();
  const system = new Option("系统默认英语声音", "");
  voiceSelect.add(system);
  for (const voice of voices) voiceSelect.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI, false, voice.voiceURI === saved));
  if (saved && !voices.some((voice) => voice.voiceURI === saved)) voiceSelect.value = "";
  status.textContent = voices.length ? `已找到 ${voices.length} 个这台设备可用的英语声音。` : "未读取到可选声音；试听会使用这台设备的系统默认英语声音。";
}
function selectedVoice() { return voices.find((voice) => voice.voiceURI === voiceSelect.value) || null; }
function speak() {
  const text = String(wordInput.value || "").trim();
  if (!text) return;
  const request = ++activeRequest;
  const voice = selectedVoice();
  try { speechSynthesis.cancel(); speechSynthesis.resume(); } catch { /* Use the direct tap path where supported. */ }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || "en-US";
  utterance.rate = 1;
  utterance.pitch = 1;
  if (voice) utterance.voice = voice;
  utterance.onstart = () => { if (request === activeRequest) status.textContent = voice ? `正在试听：${voice.name} · ${voice.lang}` : "正在试听：系统默认英语声音"; };
  utterance.onend = () => { if (request === activeRequest) status.textContent = "试听完成。可选择另一种声音继续比较。"; };
  utterance.onerror = (event) => { if (request === activeRequest && event.error !== "canceled" && event.error !== "interrupted") status.textContent = "这台设备暂时无法播放，请检查静音与媒体音量后再试。"; };
  speechSynthesis.speak(utterance);
  try { speechSynthesis.resume(); } catch { /* Older Safari uses the first speak call. */ }
}

voiceSelect.addEventListener("change", () => localStorage.setItem(STORAGE_KEY, voiceSelect.value));
speakButton.addEventListener("click", speak);
if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener("voiceschanged", renderVoices);
  renderVoices();
} else {
  speakButton.disabled = true;
  status.textContent = "这台浏览器不支持系统朗读。";
}
