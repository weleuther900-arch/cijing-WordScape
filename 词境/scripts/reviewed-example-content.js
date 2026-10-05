"use strict";

// Review data is a tracked source, not a generator acceptance flag.
const crypto = require("node:crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function fingerprint(entry, senses) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({ entry, senses }))).digest("hex");
}
function dictionaryWithCorrections(dictionary, corrections) {
  const result = { ...dictionary };
  for (const [word, senses] of Object.entries(corrections.dictionaryOverrides || {})) {
    if (!dictionary[word] || !corrections.entries[word] || !corrections.reviews[word]?.source ||
        !corrections.reviews[word]?.decision) throw new Error("unsupported dictionary correction: " + word);
    if (!Array.isArray(senses) || !senses.length ||
        senses.some((sense) => !sense.id || !/^(n|v|adj|adv|prep|pron|conj|aux|art|det|num|int)\.$/.test(sense.partOfSpeech) ||
          !/\p{Script=Han}/u.test(sense.sense || "")) ||
        new Set(senses.map((sense) => sense.id)).size !== senses.length) {
      throw new Error("invalid dictionary correction: " + word);
    }
    result[word] = { ...dictionary[word], senses };
  }
  return result;
}
function reviewSummary(entries, dictionary, corrections, ledger, words) {
  const expected = new Set(words);
  const extraWords = Object.keys(entries).filter((word) => !expected.has(word));
  const pending = [];
  const invalid = [];
  let reviewed = 0;
  for (const word of expected) {
    const entry = entries[word];
    const senses = dictionary[word]?.senses;
    if (!entry || !senses?.length) { invalid.push(word); continue; }
    const known = new Set(senses.map((sense) => sense.id));
    const groups = entry.senseGroups || [];
    const examples = entry.examples || [];
    const sourceIds = groups.flatMap((group) => group.sourceSenseIds || []);
    if (examples.length < 1 || examples.length > 5 || groups.length !== examples.length ||
        new Set(groups.map((group) => group.id)).size !== groups.length ||
        groups.some((group) => !group.id || !group.sense || !group.partOfSpeech ||
          !group.sourceSenseIds?.length || group.sourceSenseIds.some((id) => !known.has(id)) ||
          examples.filter((example) => example.senseId === group.id).length !== 1) ||
        new Set(sourceIds).size !== sourceIds.length) { invalid.push(word); continue; }
    const currentFingerprint = fingerprint(entry, senses);
    const correction = corrections.entries[word];
    const evidence = corrections.reviews[word];
    // Targeted authored corrections are reviewed together with their evidence.
    // Other candidates need a separate review of this exact content + dictionary.
    const reviewedCorrection = correction && evidence?.source && evidence?.decision &&
      corrections.reviewFingerprints?.[word] === currentFingerprint &&
      fingerprint(correction, senses) === currentFingerprint;
    const approval = ledger.entries?.[word];
    const reviewedCandidate = approval?.status === "approved" &&
      approval.fingerprint === currentFingerprint && approval.reviewedAt &&
      approval.reviewer && approval.notes && approval.sources?.length;
    if (reviewedCorrection || reviewedCandidate) reviewed += 1;
    else pending.push(word);
  }
  return { totalWords: expected.size, reviewed, pending, invalid, extraWords };
}
module.exports = { fingerprint, dictionaryWithCorrections, reviewSummary };
