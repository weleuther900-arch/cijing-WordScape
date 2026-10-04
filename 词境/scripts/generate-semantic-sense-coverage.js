"use strict";

// Resumable Codex writer. Drafts are deliberately separate from the published
// library until every requested sense has passed structural validation.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const planPath = path.join(root, "data", "semantic-sense-coverage-plan.json");
const draftPath = path.join(root, "data", "semantic-sense-coverage-drafts.js");
const draftDir = path.join(root, "data", "semantic-sense-coverage-codex-drafts");
const codexPath = path.join(root, "tools", "codex-cli", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

function readAssignment(file, name) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`${file} does not define ${name}`);
  return JSON.parse(raw.slice(at + marker.length).trim().replace(/;$/, ""));
}

function writeDrafts(entries, outputPath) {
  fs.writeFileSync(outputPath, `window.SEMANTIC_SENSE_COVERAGE_DRAFTS = ${JSON.stringify({ entries })};\n`, "utf8");
}

function normal(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function containsForm(sentence, form) {
  return new RegExp(`(^|[^a-z])${String(form).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`, "i").test(sentence);
}

function validExample(word, example, target, known) {
  const sentence = normal(example?.sentence);
  const translation = normal(example?.translation);
  const form = normal(example?.targetForm);
  if (String(example?.senseId) !== target.id) return "unknown sense ID";
  if (!sentence || !translation || !form) return "missing field";
  if (!/^[A-Z]/.test(sentence) || !/\.$/.test(sentence)) return "invalid English punctuation";
  if (sentence.split(/\s+/).length < 8 || sentence.split(/\s+/).length > 32) return "English length";
  if (!/。$/.test(translation)) return "invalid Chinese punctuation";
  if (!containsForm(sentence, form)) return "target form absent";
  if (known.has(sentence.toLowerCase())) return "duplicate sentence";
  return null;
}

function prompt(items) {
  return JSON.stringify({
    task: "Write missing bilingual examples for precisely the supplied dictionary senses.",
    rules: [
      "Return every requested word once. For each targetSense return exactly one new example, with senseId exactly equal to that targetSense id.",
      "Before writing, compare every targetSense with retainedExamples and the other targetSenses. If Chinese meanings are synonyms or near-synonyms in this context, keep only the clearest representative and list every omitted synonymous id in omittedSenseIds. Never write duplicate examples for synonyms. Differences only of intensity, attitude, or generic help are near-synonyms: for example 鼓励、支持、激励 must normally be represented by one example, unless a supplied definition names a clearly different concrete use.",
      "A targetSense that is truly different in meaning must receive one example. Never merge two genuinely different target senses or use a target sense for a different meaning.",
      "Do not repeat, paraphrase, or change retainedExamples. Do not add examples for omittedForCap senses.",
      "Use the earlier project quality standard as a hard requirement: do not imitate any weak historical wording, awkward collocation, vague context, literal translation, or unnatural textbook-like sentence; every new pair must be worth showing to a serious learner.",
      "English sentence: self-contained, natural, declarative, 8-32 words, starts with a capital letter, ends with one period, and naturally contains targetForm literally; targetForm must exactly match the form used in the sentence.",
      "Chinese translation: concise idiomatic Simplified Chinese translation of the whole English sentence, ends with one Chinese full stop。.",
      "Use realistic educational, daily-life, workplace, scientific, or public contexts. No dialogue, question, exclamation, quotation, template, invented statistic, or filler.",
      "Before returning, perform a native-speaker quality review of every pair: the English must sound idiomatic and naturally motivated, with a specific plausible situation; reject stiff, vague, repetitive, translated-from-Chinese, or textbook-template sentences.",
      "Make the target sense unmistakable from context, use natural collocations and varied subjects, and avoid filler openings, invented facts, awkward modifiers, and unnatural verb patterns.",
      "Check that the Chinese translation faithfully conveys the whole sentence and the intended target sense without adding or omitting facts; rewrite any weak sentence rather than returning it.",
      "Check grammar, collocation and exact word sense before returning."
    ],
    returnShape: { items: [{ word: "exact word", omittedSenseIds: ["only supplied near-synonym ids"], examples: [{ sentence: "English.", translation: "中文。", targetForm: "exact form", senseId: "supplied id" }] }] },
    items
  }, null, 0);
}

function callCodex(payload, batchNo, model, outputPath) {
  const workerDir = path.join(draftDir, path.basename(outputPath, ".js").replace(/[^a-z0-9_-]/gi, "_"));
  fs.mkdirSync(workerDir, { recursive: true });
  const promptFile = path.join(workerDir, `${String(batchNo).padStart(5, "0")}.prompt.json`);
  const outputFile = path.join(workerDir, `${String(batchNo).padStart(5, "0")}.result.js`);
  fs.writeFileSync(promptFile, `${payload}\n\nReturn exactly window.SEMANTIC_SENSE_DRAFT = {"items":[...]}; with no Markdown or commentary.\n`, "utf8");
  const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 900000);
  const maxAttempts = Number(process.env.CODEX_RETRIES || 2);
  let result;
  let parseError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    result = spawnSync(codexPath, ["exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins", "--disable", "remote_plugin", "--sandbox", "read-only", "-m", model, "-C", root, "-o", outputFile, "-"], { cwd: root, input: fs.readFileSync(promptFile), encoding: "utf8", timeout: timeoutMs });
    if (!result.error || result.error.code !== "ETIMEDOUT" || attempt === maxAttempts) break;
  }
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(outputFile)) throw new Error(`Codex exited ${result.status}: ${(result.stderr || result.stdout || "").slice(-400)}`);
  try {
    return readAssignment(outputFile, "SEMANTIC_SENSE_DRAFT");
  } catch (error) {
    parseError = error;
  }
  // Codex can finish while the redirected file is still being flushed. Retry
  // the same request instead of terminating the whole partition and losing the
  // already written batches.
  if (parseError) {
    for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      const retry = spawnSync(codexPath, ["exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins", "--disable", "remote_plugin", "--sandbox", "read-only", "-m", model, "-C", root, "-o", outputFile, "-"], { cwd: root, input: fs.readFileSync(promptFile), encoding: "utf8", timeout: timeoutMs });
      if (retry.error) {
        if (retry.error.code === "ETIMEDOUT" && attempt < maxAttempts) continue;
        throw retry.error;
      }
      if (retry.status !== 0 || !fs.existsSync(outputFile)) {
        if (attempt < maxAttempts) continue;
        throw new Error(`Codex exited ${retry.status}: ${(retry.stderr || retry.stdout || "").slice(-400)}`);
      }
      try {
        return readAssignment(outputFile, "SEMANTIC_SENSE_DRAFT");
      } catch (error) {
        parseError = error;
      }
    }
    throw parseError;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const limitAt = argv.indexOf("--limit-words");
  const batchAt = argv.indexOf("--batch-size");
  const modelAt = argv.indexOf("--model");
  const outputAt = argv.indexOf("--output");
  const partitionIndexAt = argv.indexOf("--partition-index");
  const partitionCountAt = argv.indexOf("--partition-count");
  const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) : 5;
  const batchSize = batchAt >= 0 ? Number(argv[batchAt + 1]) : 3;
  const model = modelAt >= 0 ? String(argv[modelAt + 1]) : "gpt-5.6-terra";
  const outputPath = outputAt >= 0 ? path.resolve(root, String(argv[outputAt + 1])) : draftPath;
  const partitionIndex = partitionIndexAt >= 0 ? Number(argv[partitionIndexAt + 1]) : 0;
  const partitionCount = partitionCountAt >= 0 ? Number(argv[partitionCountAt + 1]) : 1;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(batchSize) || batchSize < 1) throw new Error("limits must be positive integers");
  if (!Number.isInteger(partitionIndex) || !Number.isInteger(partitionCount) || partitionCount < 1 || partitionIndex < 0 || partitionIndex >= partitionCount) throw new Error("invalid partition");
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const baseline = fs.existsSync(draftPath) ? readAssignment(draftPath, "SEMANTIC_SENSE_COVERAGE_DRAFTS").entries || {} : {};
  const own = outputPath !== draftPath && fs.existsSync(outputPath) ? readAssignment(outputPath, "SEMANTIC_SENSE_COVERAGE_DRAFTS").entries || {} : {};
  const existing = { ...baseline, ...own };
  const pending = Object.entries(plan.entries).filter(([word, item], index) => item.requestedCount > 0 && index % partitionCount === partitionIndex && !existing[word]).slice(0, limit);
  let completed = 0;
  const failures = [];
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const requests = batch.map(([word, item]) => ({ word, targetSenses: item.targetSenses, retainedExamples: item.retainedExamples, omittedForCap: item.omittedForCap }));
    const response = callCodex(prompt(requests), offset / batchSize + 1, model, outputPath);
    const rows = new Map((response.items || []).filter((row) => row && row.word).map((row) => [String(row.word).toLowerCase(), row]));
    for (const [word, item] of batch) {
      const row = rows.get(word.toLowerCase());
      const targets = new Map(item.targetSenses.map((sense) => [sense.id, sense]));
      const known = new Set(item.retainedExamples.map((example) => normal(example.sentence).toLowerCase()));
      const omitted = new Set((row?.omittedSenseIds || []).map(String));
      const accepted = [];
      const reasons = [];
      for (const example of row?.examples || []) {
        const target = targets.get(String(example?.senseId));
        if (!target || omitted.has(String(example?.senseId)) || accepted.some((item) => item.senseId === target.id)) { reasons.push("wrong or repeated sense"); continue; }
        const reason = validExample(word, example, target, known);
        if (reason) { reasons.push(reason); continue; }
        const cleaned = { sentence: normal(example.sentence), translation: normal(example.translation), targetForm: normal(example.targetForm), senseId: target.id };
        accepted.push(cleaned);
        known.add(cleaned.sentence.toLowerCase());
      }
      const allCovered = accepted.length + omitted.size === item.requestedCount && [...omitted].every((id) => targets.has(id));
      if (!allCovered || !accepted.length) {
        failures.push({ word, reasons: [...new Set(reasons)].slice(0, 6) });
        continue;
      }
      existing[word] = { examples: accepted, omittedSenseIds: [...omitted] };
      completed += 1;
    }
    writeDrafts(existing, outputPath);
    console.log(JSON.stringify({ partitionIndex, partitionCount, processed: Math.min(offset + batch.length, pending.length), requested: pending.length, acceptedWords: completed, failures: failures.length }));
  }
  console.log(JSON.stringify({ status: "complete", requested: pending.length, acceptedWords: completed, failures }));
}

main();
