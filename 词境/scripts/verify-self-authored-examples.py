"""Verify every self-authored example batch before it can enter the release library."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def js(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def sentence_skeleton(sentence: str, target_form: str) -> str:
    """Return a conservative cross-word template fingerprint.

    We deliberately reject only an *identical* sentence after its tested
    surface form has been hidden.  This catches actual fill-in-the-blank
    templates without treating ordinary English grammar as a template.
    """
    normalized = " ".join(str(sentence).lower().split())
    form = str(target_form).strip().lower()
    if not form:
        return normalized
    return re.sub(rf"(?<![a-z]){re.escape(form)}(?![a-z])", "<target>", normalized)


def generator_tools():
    spec = importlib.util.spec_from_file_location("sense_tools", ROOT / "scripts" / "generate-sense-tagged-examples.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def self_authored_paths() -> list[Path]:
    """Read the original baseline before numbered reviewed replacements.

    The unnumbered file is the historical starter set.  Numbered files are
    later, word-level review batches, so they must win when a word was
    deliberately corrected without discarding the original source file.
    """
    baseline = ROOT / "data" / "self-authored-examples.js"
    replacements = sorted(
        path for path in ROOT.glob("data/self-authored-examples*.js")
        if path != baseline
    )
    return ([baseline] if baseline.exists() else []) + replacements


def supplemental_paths() -> list[Path]:
    """Read additive pairs that fill a word's audited shortfall."""
    return sorted(ROOT.glob("data/self-authored-supplements*.js"))


def normalize_direct_entries(entries: dict, senses: dict) -> dict:
    """Normalise lightweight source-sense arrays for the strict checker."""
    for word, entry in list(entries.items()):
        if not isinstance(entry, list):
            continue
        by_id = {str(item.get("id", "")): item for item in senses.get(word, {}).get("senses", [])}
        used_ids = []
        for example in entry:
            sense_id = str(example.get("senseId", ""))
            if sense_id in by_id and sense_id not in used_ids:
                used_ids.append(sense_id)
        source_to_group = {sense_id: f"sense-{index}" for index, sense_id in enumerate(used_ids, start=1)}
        entries[word] = {
            "senseGroups": [
                {
                    "id": source_to_group[sense_id],
                    "partOfSpeech": by_id[sense_id].get("partOfSpeech", ""),
                    "sourceSenseIds": [sense_id],
                    "sense": by_id[sense_id].get("sense", ""),
                }
                for sense_id in used_ids
            ],
            "examples": [
                {
                    **example,
                    "senseId": source_to_group.get(str(example.get("senseId", "")), ""),
                }
                for example in entry
            ],
        }
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify directly authored bilingual example batches.")
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="fail unless every word in the bundled wordbook has a reviewed set of five examples",
    )
    args = parser.parse_args()
    tools = generator_tools()
    senses = js(ROOT / "public" / "word-senses.js")["entries"]
    wordbook = json.loads((ROOT / "public" / "bundled-imports" / "27-one.json").read_text(encoding="utf-8"))
    target_words = {str(word).strip().lower() for word in wordbook.get("words", []) if str(word).strip()}
    entries = {}
    codex_candidates = ROOT / "data" / "codex-reviewed-examples.js"
    if codex_candidates.exists():
        entries.update(js(codex_candidates).get("entries", {}))
    for path in self_authored_paths():
        payload = js(path)
        # Older batches use {entries: {...}}, whereas current reviewed
        # batches expose {word: [examples]} directly.  Read both layouts.
        entries.update(payload.get("entries", payload))
    supplements = {}
    for path in supplemental_paths():
        payload = js(path)
        supplements.update(payload.get("entries", payload))
    # Direct reviewed batches retain original source sense IDs on each
    # example.  Normalise their lightweight array layout into the record
    # layout expected by the strict validator.
    entries = normalize_direct_entries(entries, senses)
    supplements = normalize_direct_entries(supplements, senses)
    failures = []
    for word, entry in sorted(entries.items()):
        source_senses = senses.get(word, {}).get("senses", [])
        requested = {"word": word, "sourceSenses": source_senses}
        groups, errors = tools.normalize_groups(requested, entry.get("senseGroups"))
        examples = entry.get("examples", [])
        if len(examples) != 5:
            errors.append(f"expected five examples, found {len(examples)}")
        seen = []
        for example in examples:
            valid, reason = tools.strictly_valid(word, example, set(groups))
            if not valid:
                errors.append(reason)
            elif tools.near_duplicate(str(example["sentence"]), word, seen):
                errors.append("sentence is too similar to another example")
            else:
                seen.append(example)
        if errors:
            failures.append({"word": word, "errors": errors})

    for word, entry in sorted(supplements.items()):
        source_senses = senses.get(word, {}).get("senses", [])
        requested = {"word": word, "sourceSenses": source_senses}
        groups, errors = tools.normalize_groups(requested, entry.get("senseGroups"))
        examples = entry.get("examples", [])
        if not 1 <= len(examples) <= 5:
            errors.append(f"expected one to five supplemental examples, found {len(examples)}")
        seen = []
        for example in examples:
            valid, reason = tools.strictly_valid(word, example, set(groups))
            if not valid:
                errors.append(reason)
            elif tools.near_duplicate(str(example["sentence"]), word, seen):
                errors.append("sentence is too similar to another supplemental example")
            else:
                seen.append(example)
        if errors:
            failures.append({"word": word, "errors": errors})

    # Reject actual sentence templates across different words too.  The
    # per-word near-duplicate test above is insufficient when a generator
    # merely substitutes a new target word into the same sentence frame.
    skeleton_index: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for collection in (entries, supplements):
        for word, entry in collection.items():
            for example in entry.get("examples", []):
                skeleton = sentence_skeleton(example.get("sentence", ""), example.get("targetForm", word))
                skeleton_index[skeleton].append((word, str(example.get("sentence", ""))))
    repeated = {
        skeleton: rows for skeleton, rows in skeleton_index.items()
        if len({word for word, _ in rows}) > 1
    }
    if repeated:
        by_word: dict[str, list[str]] = defaultdict(list)
        for skeleton, rows in repeated.items():
            words = ", ".join(sorted({word for word, _ in rows}))
            for word, _ in rows:
                by_word[word].append(f"reused cross-word sentence skeleton ({words})")
        existing = {item["word"]: item for item in failures}
        for word, errors in sorted(by_word.items()):
            if word in existing:
                existing[word]["errors"].extend(errors)
            else:
                failures.append({"word": word, "errors": errors})
    missing_words = sorted(target_words - set(entries))
    report = {
        "targetWords": len(target_words),
        "reviewedWords": len(entries),
        "reviewedExamples": sum(len(entry.get("examples", [])) for entry in entries.values()),
        "supplementalWords": len(supplements),
        "supplementalExamples": sum(len(entry.get("examples", [])) for entry in supplements.values()),
        "missingReviewedWords": len(missing_words),
        "missingReviewedWordSample": missing_words[:30],
        "invalidWords": len(failures),
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures or (args.require_complete and missing_words):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
