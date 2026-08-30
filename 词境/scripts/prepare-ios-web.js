"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUT_DIR = path.join(ROOT, "ios-web");
const DICTIONARY_FILE = path.join(ROOT, "data", "offline-dictionary.json");

async function main() {
  try {
    await fs.access(DICTIONARY_FILE);
  } catch {
    throw new Error("离线词典尚未安装。请先运行 npm.cmd run dictionary:install。");
  }

  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.cp(PUBLIC_DIR, OUTPUT_DIR, { recursive: true });
  // The full library and historical generator outputs are not loaded by the
  // app.  Shipping them only makes the iPhone installation larger and slower;
  // the active two-letter shards remain available on demand.
  await fs.rm(path.join(OUTPUT_DIR, "ai-examples-full.js"), { force: true });
  await fs.rm(path.join(OUTPUT_DIR, "example-library.js"), { force: true });
  for (const name of await fs.readdir(OUTPUT_DIR)) {
    if (/^ai-example-library\..+\.js$/u.test(name)) await fs.rm(path.join(OUTPUT_DIR, name), { force: true });
  }
  const vendorDir = path.join(OUTPUT_DIR, "vendor");
  await fs.mkdir(vendorDir, { recursive: true });
  await Promise.all([
    fs.copyFile(path.join(ROOT, "node_modules", "mammoth", "mammoth.browser.min.js"), path.join(vendorDir, "mammoth.browser.min.js")),
    fs.copyFile(path.join(ROOT, "node_modules", "fflate", "umd", "index.js"), path.join(vendorDir, "fflate.min.js")),
    fs.copyFile(path.join(ROOT, "node_modules", "pdfjs-dist", "build", "pdf.mjs"), path.join(vendorDir, "pdf.mjs")),
    fs.copyFile(path.join(ROOT, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs"), path.join(vendorDir, "pdf.worker.mjs"))
  ]);
  const dictionary = await fs.readFile(DICTIONARY_FILE);
  await fs.writeFile(path.join(OUTPUT_DIR, "offline-dictionary.json.gz"), zlib.gzipSync(dictionary, { level: 9 }));
  console.log(`iOS 静态发布包已生成：${OUTPUT_DIR}`);
  console.log("请将 ios-web 文件夹部署到 HTTPS 静态网站，再用 iPhone 或 iPad 的 Safari 添加到主屏幕。");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
