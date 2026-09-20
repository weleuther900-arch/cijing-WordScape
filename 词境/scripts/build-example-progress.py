"""Build a truthful progress snapshot for the offline example-production task."""

from __future__ import annotations

import json
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / "public" / "bundled-imports" / "27-one.json"
OUTPUT = ROOT / "data" / "example-production-progress.json"


def read_js(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    marker = "window.WORD_AI_EXAMPLE_LIBRARY ="
    if marker not in text:
        return {"entries": {}}
    return json.loads(text.split(marker, 1)[1].strip().rstrip(";"))


def entry_is_ready(entry: dict) -> bool:
    examples = entry.get("examples", [])
    groups = entry.get("senseGroups", [])
    return len(examples) == 5 and bool(groups) and all(
        item.get("sentence") and item.get("translation") and item.get("senseId")
        for item in examples
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="Write the snapshot file when the runtime has workspace write access.")
    args = parser.parse_args()
    words = [str(item).lower() for item in json.loads(BOOK.read_text(encoding="utf-8"))["words"]]
    sources = sorted((ROOT / "data").glob("codex-sense-examples-*.js")) + sorted((ROOT / "data").glob("audited-legacy-*.js"))
    ready: set[str] = set()
    source_by_word: dict[str, str] = {}
    for path in sources:
        for word, entry in read_js(path).get("entries", {}).items():
            if entry_is_ready(entry):
                ready.add(word.lower())
                source_by_word[word.lower()] = path.name
    legacy_words: set[str] = set()
    legacy_examples = 0
    for path in sorted((ROOT / "public").glob("ai-example-library.part-*.js")):
        entries = read_js(path).get("entries", {})
        legacy_words.update(entries)
        legacy_examples += sum(len(item.get("examples", [])) for item in entries.values())
    snapshot = {
        "totalWords": len(words),
        "readyWords": len(ready),
        "readyExamples": len(ready) * 5,
        "remainingWords": len([word for word in words if word not in ready]),
        "legacyWordsAwaitingSenseAudit": len(legacy_words - ready),
        "legacyExamplesAwaitingSenseAudit": legacy_examples - len(legacy_words & ready) * 5,
        "readyWordSources": source_by_word,
    }
    if args.write:
        OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(snapshot, ensure_ascii=False))


if __name__ == "__main__":
    main()
