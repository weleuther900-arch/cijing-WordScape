"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { unzipSync, strFromU8 } = require("fflate");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = process.argv[2];
const OUTPUT = path.join(ROOT, "public", "bundled-imports", "27-one.json");
const DICTIONARY_FILE = path.join(ROOT, "data", "offline-dictionary.json");

function decodeXmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
}

function cellColumn(reference) { return String(reference || "").replace(/\d/g, "").toUpperCase(); }

function xlsxRows(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const readText = (name) => archive[name] ? strFromU8(archive[name]) : "";
  const sharedStrings = [];
  for (const match of readText("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sharedStrings.push(decodeXmlText(match[1]));
  const rows = [];
  const sheets = Object.keys(archive).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort();
  for (const sheetName of sheets) {
    for (const row of readText(sheetName).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = {};
      for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const reference = cell[1].match(/\br="([^"]+)"/i)?.[1];
        const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
        const body = cell[2];
        const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
        const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1];
        const text = type === "s" ? sharedStrings[Number(value)] : decodeXmlText(inline || value);
        if (reference && text) values[cellColumn(reference)] = text.trim();
      }
      if (Object.keys(values).length) rows.push(values);
    }
  }
  return rows;
}

function wordFromCell(value) {
  const text = String(value || "").trim().replace(/[‐‑–—]/g, "-");
  if (!text || /^(word|words|单词|序号|编号)$/i.test(text)) return null;
  if (/^[a-z]+(?:[ '-][a-z]+)*$/i.test(text)) return text.toLowerCase();
  const match = text.match(/^([a-z]+(?:[ '-][a-z]+)*)(?=\s|[.,;:，；（(\[]|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function chooseWordColumn(rows) {
  const scores = new Map();
  rows.forEach((row) => Object.entries(row).forEach(([column, value]) => {
    const word = wordFromCell(value);
    if (word) scores.set(column, (scores.get(column) || 0) + 1);
  }));
  const [column] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!column) throw new Error("没有识别到包含英文单词的列");
  return { column, scores };
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

async function main() {
  if (!SOURCE) throw new Error("请提供 Excel 文件路径");
  const [buffer, dictionaryText] = await Promise.all([fs.readFile(SOURCE), fs.readFile(DICTIONARY_FILE, "utf8")]);
  const rows = xlsxRows(buffer);
  const { column, scores } = chooseWordColumn(rows);
  const words = shuffle([...new Set(rows.map((row) => wordFromCell(row[column])).filter(Boolean))]);
  if (!words.length) throw new Error("没有提取到可导入的英文单词");
  const dictionary = JSON.parse(dictionaryText).entries || {};
  const entries = Object.fromEntries(words.flatMap((word) => dictionary[word] ? [[word, dictionary[word]]] : []));
  const payload = {
    id: "27-one-20260807",
    notebookName: "27-One",
    source: path.basename(SOURCE),
    words,
    entries
  };
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, `${JSON.stringify(payload)}\n`, "utf8");
  const verified = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  console.log(`已读取 ${rows.length} 行，选择 ${column} 列（候选 ${scores.get(column)} 项）。`);
  console.log(`已提取并重新打乱 ${verified.words.length} 个不重复英文词；词典命中 ${Object.keys(verified.entries).length} 个。`);
  console.log(`前 16 个：${words.slice(0, 16).join(", ")}`);
  console.log(`输出：${OUTPUT}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
