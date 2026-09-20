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


def main() -> None:
    parser = ArgumentParser(description="Verify a source example library against its browser shards.")
    parser.add_argument("--source", type=Path, default=ROOT / "data" / "corpus-backed-examples.js", help="Source library, relative to the 词境 directory unless absolute.")
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
        errors = []
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

    report = {"source": str(source), "targetWords": len(target_words), "finalWords": len(final), "wordsHeldForReviewedRewrite": len(target_words - set(final)), "finalExamples": sum(len(entry["examples"]) for entry in final.values()), "invalidFinalWords": len(failures), "wordsWithNoRepeatFallback": no_repeat_fallback, "multiSenseWords": multi_sense_words, "multiSenseWordsThatCanSwitchAfterCorrect": correct_can_switch, "iosShards": len(index), "iosShardMatchesFinal": shard_ok, "iosFullLibraryMatchesFinal": full_static_ok, "deepseekWords": len(old), "deepseekStructurallyValid": old_checked}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures or not shard_ok or not full_static_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
