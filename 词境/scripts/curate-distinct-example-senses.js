"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "full-library-audit-candidate-final.js");
const outputPath = path.join(root, "data", "context-resolved-examples.js");
const reportPath = path.join(root, "data", "distinct-example-sense-report.json");

function readAssignment(file, name) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const marker = `window.${name} =`;
  if (!raw.includes(marker)) throw new Error(`${file} does not define ${name}`);
  return JSON.parse(raw.slice(raw.indexOf(marker) + marker.length).trim().replace(/;$/, ""));
}

function writeAssignment(file, payload) {
  fs.writeFileSync(file, `window.WORD_AI_EXAMPLE_LIBRARY = ${JSON.stringify(payload)};\n`, "utf8");
}

function normalizedTerms(sense) {
  const terms = String(sense || "")
    .replace(/[（(【\[].*?[）)】\]]/g, "")
    .split(/[；;、，,／/]/)
    .map((term) => term.replace(/^(?:[a-z]+\.)\s*/i, "").replace(/[的地得]$/u, "").trim())
    .filter((term) => /[\u3400-\u9fff]/u.test(term));
  return [...new Set(terms)].sort();
}

function semanticKey(group) {
  const terms = normalizedTerms(group?.sense);
  return terms.length ? terms.join("|") : `${group?.partOfSpeech || ""}|${group?.id || ""}`;
}

function sameSemanticSense(left, right) {
  const a = normalizedTerms(left?.sense);
  const b = normalizedTerms(right?.sense);
  return a.length > 0 && b.length > 0 && a.some((term) => b.some((other) => term === other || term.includes(other) || other.includes(term)));
}

const RETAIL = {
  senseGroups: [
    { id: "retail-sale", partOfSpeech: "n.", sourceSenseIds: ["n-1"], sense: "零售", contextReviewed: true, semanticDistinct: true },
    { id: "retail-detail", partOfSpeech: "v.", sourceSenseIds: ["v-2"], sense: "详述", contextReviewed: true, semanticDistinct: true },
    { id: "retail-spread", partOfSpeech: "v.", sourceSenseIds: ["v-3"], sense: "传播", contextReviewed: true, semanticDistinct: true }
  ],
  examples: [
    { sentence: "The neighbourhood shop depends on retail sales to cover its rent and staff costs.", translation: "这家社区商店依靠零售额支付租金和员工成本。", targetForm: "retail", senseId: "retail-sale" },
    { sentence: "The witness retailed the events in order, allowing the committee to understand what had happened.", translation: "证人按顺序详述了事件经过，使委员会能够了解事情的原委。", targetForm: "retailed", senseId: "retail-detail" },
    { sentence: "Travellers once retailed news from distant towns when they returned to their villages.", translation: "过去旅行者回到村庄时常会传播远方城镇的消息。", targetForm: "retailed", senseId: "retail-spread" }
  ]
};

function singleSense(partOfSpeech, sourceSenseId, sense, example) {
  return {
    senseGroups: [{ id: "semantic-1", partOfSpeech, sourceSenseIds: [sourceSenseId], sense, contextReviewed: true, semanticDistinct: true }],
    examples: [{ ...example, senseId: "semantic-1" }]
  };
}

const ENTRY_REPAIRS = {
  retail: RETAIL,
  a: singleSense("art.", "other-2", "一（个）", { sentence: "A balanced diet helps students maintain energy throughout demanding examination periods.", translation: "均衡饮食有助于学生在紧张的考试阶段保持精力。", targetForm: "A" }),
  "according to": singleSense("prep.", "other-1", "根据", { sentence: "According to the survey, most residents support a safer crossing near the primary school.", translation: "根据调查，大多数居民支持在小学附近设置更安全的人行横道。", targetForm: "According to" }),
  hello: singleSense("int.", "other-2", "喂；嘿", { sentence: "When I said hello to Tom, he hid behind his mother.", translation: "我向汤姆打招呼时，他躲到了母亲身后。", targetForm: "hello" }),
  ounce: singleSense("n.", "n-2", "少量", { sentence: "Even an ounce of practical experience can help a beginner make a wiser decision.", translation: "哪怕只有一点实践经验，也能帮助初学者作出更明智的决定。", targetForm: "ounce" }),
  scissors: singleSense("n.", "other-1", "剪刀", { sentence: "The surgeon selected curved scissors for the precise cuts required during the delicate procedure.", translation: "外科医生选择了弯头剪刀，以完成精细手术所需的精准切割。", targetForm: "scissors" }),
  trousers: singleSense("n.", "other-2", "长裤", { sentence: "Because the company requires formal attire, employees must wear tailored trousers rather than casual jeans.", translation: "由于公司要求正式着装，员工必须穿合体长裤而非休闲牛仔裤。", targetForm: "trousers" })
};

function curateEntry(entry) {
  const groups = new Map((entry.senseGroups || []).map((group) => [String(group.id), group]));
  const selectedGroups = [];
  const selectedExamples = [];
  const accepted = [];
  let removed = 0;
  for (const example of entry.examples || []) {
    const group = groups.get(String(example.senseId));
    if (!group || !example.sentence || !example.translation) continue;
    if (selectedExamples.length >= 5) break;
    if (accepted.some((acceptedGroup) => sameSemanticSense(acceptedGroup, group))) {
      removed += 1;
      continue;
    }
    accepted.push(group);
    const id = `semantic-${selectedGroups.length + 1}`;
    selectedGroups.push({
      id,
      partOfSpeech: String(group.partOfSpeech || "").trim(),
      sourceSenseIds: Array.isArray(group.sourceSenseIds) ? group.sourceSenseIds.map(String) : [],
      sense: String(group.sense || "").trim(),
      contextReviewed: true,
      semanticDistinct: true
    });
    selectedExamples.push({
      sentence: String(example.sentence).trim(),
      translation: String(example.translation).trim(),
      targetForm: String(example.targetForm || "").trim(),
      senseId: id
    });
  }
  return { entry: { senseGroups: selectedGroups, examples: selectedExamples }, removed };
}

function main() {
  const source = readAssignment(sourcePath, "WORD_AI_EXAMPLE_LIBRARY");
  const entries = {};
  let inputExamples = 0;
  let outputExamples = 0;
  let removedRepeatedSenses = 0;
  for (const [word, entry] of Object.entries(source.entries || {})) {
    inputExamples += (entry.examples || []).length;
    const curated = curateEntry(entry);
    entries[word] = curated.entry;
    outputExamples += curated.entry.examples.length;
    removedRepeatedSenses += curated.removed;
  }
  for (const [word, replacement] of Object.entries(ENTRY_REPAIRS)) {
    const priorExamples = (entries[word]?.examples || []).length;
    entries[word] = replacement;
    outputExamples += replacement.examples.length - priorExamples;
  }
  const payload = {
    source: "full audited library, curated to one example per distinct learner-facing Chinese sense",
    generatedAt: new Date().toISOString(),
    entries
  };
  writeAssignment(outputPath, payload);
  const report = {
    sourceWords: Object.keys(source.entries || {}).length,
    publishedWords: Object.keys(entries).length,
    inputExamples,
    publishedExamples: outputExamples,
    removedRepeatedSenses,
    manualSemanticCoverage: Object.keys(ENTRY_REPAIRS)
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

main();
