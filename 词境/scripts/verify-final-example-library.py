"""End-to-end integrity check for the final example library and iOS shards."""
from __future__ import annotations

import glob
import importlib.util
import json
import re
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def js(path: Path, name: str) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    payload = raw.split(f"window.{name} =", 1)[1].strip().rstrip(";")
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        payload = re.sub(r"([,{]\s*)([A-Za-z_$][\w$-]*)\s*:", lambda m: f'{m.group(1)}"{m.group(2)}":', payload)
        return json.loads(payload)


def tools():
    spec = importlib.util.spec_from_file_location("sense_tools", ROOT / "scripts" / "generate-sense-tagged-examples.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def structural_errors(entry: dict, known_senses: dict) -> list[str]:
    """Check integrity only; review flags do not prove linguistic quality."""
    errors = []
    examples = entry.get("examples", [])
    groups = entry.get("senseGroups", [])
    ids = [str(group.get("id", "")) for group in groups]
    if not 1 <= len(examples) <= 5:
        errors.append("entry must contain one to five examples")
    if any(not value for value in ids) or len(set(ids)) != len(ids):
        errors.append("missing or duplicate sense group ID")
    counts = Counter(str(example.get("senseId", "")) for example in examples)
    if set(counts) != set(ids) or any(count != 1 for count in counts.values()):
        errors.append("each sense group must have exactly one example")
    used_source_ids = set()
    meanings = []
    for group in groups:
        source_ids = [str(value) for value in group.get("sourceSenseIds", [])]
        if not source_ids or any(value not in known_senses for value in source_ids):
            errors.append("unknown or missing dictionary source sense")
        if len(set(source_ids)) != len(source_ids) or used_source_ids.intersection(source_ids):
            errors.append("dictionary source sense repeated across groups")
        used_source_ids.update(source_ids)
        meaning = re.sub(r"\s+", "", str(group.get("sense", "")))
        if not meaning or not str(group.get("partOfSpeech", "")).strip():
            errors.append("missing contextual meaning or part of speech")
        meanings.append(meaning)
    if len(set(meanings)) != len(meanings):
        errors.append("duplicate contextual meaning")
    return sorted(set(errors))


def main() -> None:
    parser = ArgumentParser(description="Verify a source example library against its browser shards.")
    parser.add_argument("--source", type=Path, default=ROOT / "data" / "context-resolved-examples.js", help="Source library, relative to the 词境 directory unless absolute.")
    args = parser.parse_args()
    source = args.source if args.source.is_absolute() else ROOT / args.source
    sense_tools = tools()
    book = json.loads((ROOT / "public" / "bundled-imports" / "27-one.json").read_text(encoding="utf-8"))
    target_words = {str(word).lower() for word in book["words"]}
    senses = js(ROOT / "public" / "word-senses.js", "WORD_SENSE_LIBRARY")["entries"]
    final = js(source, "WORD_AI_EXAMPLE_LIBRARY")["entries"]
    failures = []
    for word, entry in sorted(final.items()):
        groups = {group.get("id") for group in entry.get("senseGroups", [])}
        examples = entry.get("examples", [])
        known_senses = {str(sense.get("id", "")): sense for sense in senses.get(word, {}).get("senses", [])}
        errors = structural_errors(entry, known_senses)
        for group in entry.get("senseGroups", []):
            source_ids = [str(value) for value in group.get("sourceSenseIds", [])]
            reviewed_semantic_sense = bool(group.get("contextReviewed") and group.get("semanticDistinct") and str(group.get("partOfSpeech", "")).strip() and str(group.get("sense", "")).strip())
            if len(source_ids) != 1:
                if reviewed_semantic_sense:
                    continue
                errors.append("context group must contain exactly one source sense")
                continue
            matched_sense = known_senses.get(source_ids[0])
            if matched_sense is None:
                if not reviewed_semantic_sense:
                    errors.append("context group has no reviewed resolvable source sense")
            elif not reviewed_semantic_sense and (group.get("partOfSpeech") != matched_sense.get("partOfSpeech") or group.get("sense") != matched_sense.get("sense")):
                errors.append("context group disagrees with the dictionary sense")
        if not examples:
            errors.append("entry has no publishable examples")
        if len({" ".join(str(example.get("sentence", "")).lower().split()) for example in examples}) != len(examples):
            errors.append("entry repeats a sentence")
        for example in examples:
            valid, reason = sense_tools.locally_valid(word, example, groups)
            if not valid:
                errors.append(reason)
        if errors:
            failures.append((word, errors))

    multi_sense_words = 0
    correct_can_switch = 0
    no_repeat_fallback = 0
    for entry in final.values():
        sentence_keys = {" ".join(example["sentence"].lower().split()) for example in entry["examples"]}
        if len(sentence_keys) >= 2:
            no_repeat_fallback += 1
        groups = {group["id"] for group in entry["senseGroups"]}
        counts = Counter(example["senseId"] for example in entry["examples"])
        if len(groups) > 1:
            multi_sense_words += 1
            if all(any(other != sense_id and counts[other] for other in groups) for sense_id in counts):
                correct_can_switch += 1

    index = js(ROOT / "public" / "ai-example-index.js", "WORD_AI_EXAMPLE_INDEX")
    shard_entries = {}
    for url in index.values():
        shard = js(ROOT / "public" / url.removeprefix("./"), "WORD_AI_EXAMPLE_CHUNK")["entries"]
        shard_entries.update(shard)
    shard_ok = shard_entries == final
    full_static = js(ROOT / "public" / "ai-examples-full.js", "WORD_AI_EXAMPLE_LIBRARY")["entries"]
    full_static_ok = full_static == final

    old = {}
    for name in glob.glob(str(ROOT / "public" / "ai-example-library*.js")):
        old.update(js(Path(name), "WORD_AI_EXAMPLE_LIBRARY").get("entries", {}))
    old_checked = 0
    for word, item in old.items():
        if word not in senses:
            continue
        pos = senses[word]["senses"][0]["partOfSpeech"]
        group = {"id": "sense-1", "partOfSpeech": pos, "sourceSenseIds": [entry["id"] for entry in senses[word]["senses"] if entry["partOfSpeech"] == pos][:8], "sense": "已复核既有例句"}
        examples = []
        for example in item.get("examples", []):
            tokens = re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", str(example.get("sentence", "")))
            form = next((token.lower() for token in tokens if sense_tools.valid_target_form(word, token.lower())), word)
            examples.append({**example, "targetForm": form, "senseId": "sense-1"})
        result, _ = sense_tools.select_valid({"word": word, "sourceSenses": senses[word]["senses"], "requestedCount": 5, "requireStructure": False}, {"senseGroups": [group], "examples": examples})
        if result:
            old_checked += 1

    report = {"source": str(source), "targetWords": len(target_words), "finalWords": len(final), "wordsHeldForReviewedRewrite": len(target_words - set(final)), "finalExamples": sum(len(entry["examples"]) for entry in final.values()), "invalidFinalWords": len(failures), "atomicContextGroups": sum(len(entry.get("senseGroups", [])) for entry in final.values()), "wordsWithNoRepeatFallback": no_repeat_fallback, "multiSenseWords": multi_sense_words, "multiSenseWordsThatCanSwitchAfterCorrect": correct_can_switch, "iosShards": len(index), "iosShardMatchesFinal": shard_ok, "iosFullLibraryMatchesFinal": full_static_ok, "deepseekWords": len(old), "deepseekStructurallyValid": old_checked}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    missing_words = sorted(target_words - set(final))
    unexpected_words = sorted(set(final) - target_words)
    detail = {**report, "validationScope": "structural integrity; semantic distinctness and translation quality require separate review", "expectedWordCount": 5487, "missingWords": missing_words, "unexpectedWords": unexpected_words, "failures": failures}
    report_path = ROOT / "data" / "final-example-integrity-report.json"
    report_path.write_text(json.dumps(detail, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "missingWords": len(missing_words), "unexpectedWords": len(unexpected_words), "validationScope": detail["validationScope"]}, ensure_ascii=False))
    if len(target_words) != 5487 or missing_words or unexpected_words or failures or not shard_ok or not full_static_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
