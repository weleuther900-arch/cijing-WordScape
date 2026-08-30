"use strict";

// Local-first server. It listens only on this computer and saves learning data locally.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");
const { unzipSync, strFromU8 } = require("fflate");

const ROOT = __dirname;
const APP_ROOT = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "state.json");
const OFFLINE_DICTIONARY_FILE = path.join(ROOT, "data", "offline-dictionary.json");
const configuredPort = Number(process.env.WORDSCAPE_PORT || 4173);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 4173;
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 15 * 1024 * 1024;
let offlineDictionary;
let offlineDictionaryLoading;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gz": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function commonHeaders(cacheControl = "no-store") {
  return {
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function staticCacheControl(file) {
  // index.html and the worker must be revalidated so a new release is noticed
  // promptly.  Every other shell asset is versioned by the HTML file, so it
  // can be kept locally and makes repeat desktop launches much faster.
  const name = path.basename(file);
  return name === "index.html" || name === "refresh.html" || name === "service-worker.js" || name === "manifest.webmanifest"
    ? "no-cache"
    : "public, max-age=31536000, immutable";
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...commonHeaders() });
  response.end(JSON.stringify(value));
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function validState(value) {
  return value && typeof value === "object" && Array.isArray(value.words) &&
    Array.isArray(value.batches) && Array.isArray(value.logs) && value.settings &&
    typeof value.settings === "object";
}

async function saveState(value) {
  if (!validState(value)) throw httpError("Invalid state payload");
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, DATA_FILE);
}

function dictionaryPartOfSpeech(value, translation) {
  const rawTags = [
    ...String(value || "").split("/").map((entry) => entry.trim().match(/^[a-z]+/i)?.[0]).filter(Boolean),
    ...(String(translation || "").match(/\b(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\./gi) || []).map((tag) => tag.slice(0, -1))
  ];
  const aliases = { a: "adj", ad: "adv", vi: "v", vt: "v" };
  const tags = [...new Set(rawTags.map((tag) => aliases[tag.toLowerCase()] || tag.toLowerCase()))];
  return tags.length ? tags.map((tag) => `${tag}.`).join(" / ") : "词性未标注";
}

function dictionarySenses(translation) {
  return String(translation || "").replace(/\\n/g, "\n").replace(/\r/g, "").split("\n")
    .map((sense) => sense.trim().replace(/^(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.\s*/i, ""))
    .filter(Boolean).slice(0, 12);
}

async function loadOfflineDictionary() {
  if (offlineDictionary) return offlineDictionary;
  if (!offlineDictionaryLoading) {
    offlineDictionaryLoading = fs.readFile(OFFLINE_DICTIONARY_FILE, "utf8").then((text) => {
      const payload = JSON.parse(text);
      return new Map(Object.entries(payload.entries || {}));
    }).catch((error) => error.code === "ENOENT" ? new Map() : Promise.reject(error));
  }
  offlineDictionary = await offlineDictionaryLoading;
  return offlineDictionary;
}

async function lookupOfflineDictionary(words) {
  const dictionary = await loadOfflineDictionary();
  const entries = [];
  for (const rawWord of words.slice(0, 1000)) {
    const word = String(rawWord || "").trim().toLowerCase();
    const record = dictionary.get(word);
    if (!record) continue;
    const [phonetic, definition, pos] = Array.isArray(record) ? record : [record.phonetic, record.definition, record.partOfSpeech];
    const normalizedDefinition = String(definition || "").replace(/\\n/g, "\n");
    const senses = dictionarySenses(normalizedDefinition);
    if (!senses.length) continue;
    entries.push({ word, phonetic: String(phonetic || ""), definition: normalizedDefinition, partOfSpeech: dictionaryPartOfSpeech(pos, normalizedDefinition), currentSense: senses[0], senses });
  }
  return { installed: dictionary.size > 0, entries };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const parts = [];
    request.on("data", (part) => {
      bytes += part.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(httpError("Request body is too large", 413));
        request.destroy();
        return;
      }
      parts.push(part);
    });
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });
}

function decodeXmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
}

function extractXlsxText(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const fileText = (name) => archive[name] ? strFromU8(archive[name]) : "";
  const sharedStrings = [];
  for (const match of fileText("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sharedStrings.push(decodeXmlText(match[1]));
  const values = [];
  for (const name of Object.keys(archive).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort()) {
    for (const cell of fileText(name).matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
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

async function extractUploadedText(name, encodedFile) {
  const extension = path.extname(name || "").toLowerCase();
  const buffer = Buffer.from(encodedFile || "", "base64");
  if (!buffer.length) throw httpError("没有读取到文件内容");
  if (extension === ".docx") return (await mammoth.extractRawText({ buffer })).value;
  if (extension === ".xlsx" || extension === ".xlsm") return extractXlsxText(buffer);
  if (extension === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const document = await task.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    await task.destroy();
    return pages.join("\n");
  }
  if (extension === ".xls") throw httpError("请先将旧版 .xls 文件另存为 .xlsx 后再导入", 415);
  throw httpError("只支持 .txt、.docx、.xlsx、.xlsm 和 .pdf 文件", 415);
}

async function serveStatic(requestPath, response) {
  const requestFile = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const resolved = path.resolve(APP_ROOT, requestFile);
  if (!resolved.startsWith(`${APP_ROOT}${path.sep}`) && resolved !== path.join(APP_ROOT, "index.html")) {
    writeJson(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const contents = await fs.readFile(resolved);
    const extension = path.extname(resolved);
    const headers = { "Content-Type": MIME_TYPES[extension] || "application/octet-stream", ...commonHeaders(staticCacheControl(resolved)) };
    if (extension === ".gz") headers["Content-Encoding"] = "gzip";
    response.writeHead(200, headers);
    response.end(contents);
  } catch (error) {
    writeJson(response, error.code === "ENOENT" ? 404 : 500, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/health" && request.method === "GET") return writeJson(response, 200, { ok: true, storage: "local" });
    if (url.pathname === "/api/state" && request.method === "GET") return writeJson(response, 200, { state: await loadState() });
    if (url.pathname === "/api/state" && request.method === "PUT") {
      await saveState(JSON.parse(await readBody(request)).state);
      return writeJson(response, 200, { ok: true });
    }
    if (url.pathname === "/api/dictionary/lookup" && request.method === "POST") {
      const body = JSON.parse(await readBody(request));
      return writeJson(response, 200, await lookupOfflineDictionary(Array.isArray(body.words) ? body.words : []));
    }
    if (url.pathname === "/api/extract" && request.method === "POST") {
      const body = JSON.parse(await readBody(request));
      return writeJson(response, 200, { text: await extractUploadedText(body.name, body.file) });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return writeJson(response, 405, { error: "Method not allowed" });
    return serveStatic(decodeURIComponent(url.pathname), response);
  } catch (error) {
    return writeJson(response, error.statusCode || 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WordScape is running at http://${HOST}:${PORT}`);
});
