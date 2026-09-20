/*
 * Convert Chinese display/data sources to Simplified Chinese with OpenCC.
 * Usage:
 *   node scripts/normalize-simplified-chinese.js C:\\path\\to\\opencc-js\\package
 *
 * This is a mechanical source-data normalisation step.  It deliberately does
 * not touch user state, credentials, or non-Chinese content.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const packagePath = process.argv[2];
if (!packagePath) throw new Error("Pass the extracted opencc-js package path as the first argument.");
// The compact t2cn preset performs traditional-to-mainland-simplified
// conversion.  Using the Taiwan regional preset here would turn common "么"
// into the uncommon mainland variant "幺", which is not appropriate for the
// learner-facing Simplified Chinese copy.
const OpenCC = require(path.join(packagePath, "dist", "umd", "t2cn.js"));
const convert = OpenCC.Converter({ from: "t", to: "cn" });
const root = path.resolve(__dirname, "..");
// Only static vocabulary content is in scope.  User state, progress records,
// logs, credentials, and application code are deliberately excluded.
const files = [
  path.join(root, "data", "corpus-backed-examples.js"),
  path.join(root, "public", "word-senses.js"),
  path.join(root, "public", "content-library.js"),
  path.join(root, "public", "example-library.js"),
  path.join(root, "public", "bundled-imports", "27-one.json"),
  ...fs.readdirSync(path.join(root, "public", "ai-examples")).filter((name) => name.endsWith(".js")).map((name) => path.join(root, "public", "ai-examples", name)),
];
const changed = [];

for (const target of files) {
  const original = fs.readFileSync(target, "utf8");
  const normalized = convert(original).replaceAll("幺", "么");
  if (normalized !== original) {
    fs.writeFileSync(target, normalized, "utf8");
    changed.push(path.relative(root, target).replaceAll(path.sep, "/"));
  }
}
console.log(JSON.stringify({ convertedFiles: changed.length, files: changed }, null, 2));
