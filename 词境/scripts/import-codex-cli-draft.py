"""Mechanically import a Codex CLI draft into the app's flat example shape.

This is intentionally a schema adapter, not a writer: it never changes an
English or Chinese sentence.  Dictionary sense labels and parts of speech are
rebuilt from the local source-of-truth so that the strict verifier can reject
any invalid draft before it reaches the release candidate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_assignment(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    if "=" not in raw:
        raise ValueError(f"{path} is not a JavaScript assignment")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def adapt_entry(word: str, entry: dict, source_senses: dict) -> dict:
    groups: list[dict] = []
    examples: list[dict] = []
    used_source_ids: set[str] = set()
    for index, raw_group in enumerate(entry.get("senseGroups", []), start=1):
        # Some older local Codex drafts use the equivalent ``senseIds``
        # spelling.  Values are still validated against the local dictionary
        # source of truth below; this only accepts the older field label.
        source_ids = [str(value) for value in raw_group.get("sourceSenseIds", raw_group.get("senseIds", []))]
        if not source_ids or any(source_id not in source_senses for source_id in source_ids):
            raise ValueError(f"{word}: group {index} has an unknown source sense")
        if any(source_id in used_source_ids for source_id in source_ids):
            raise ValueError(f"{word}: source sense appears in more than one group")
        parts = {source_senses[source_id]["partOfSpeech"] for source_id in source_ids}
        if len(parts) != 1:
            raise ValueError(f"{word}: group {index} mixes parts of speech")
        used_source_ids.update(source_ids)
        group_id = f"sense-{index}"
        groups.append({
            "id": group_id,
            "partOfSpeech": next(iter(parts)),
            "sourceSenseIds": source_ids,
            "sense": "；".join(source_senses[source_id]["sense"] for source_id in source_ids),
        })
        for raw_example in raw_group.get("examples", []):
            examples.append({
                "sentence": raw_example.get("sentence", ""),
                "translation": raw_example.get("translation", ""),
                "targetForm": raw_example.get("targetForm", word),
                "senseId": group_id,
            })
    return {"senseGroups": groups, "examples": examples}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="CLI draft JavaScript assignment")
    parser.add_argument("--output", required=True, help="flat reviewed-batch JavaScript assignment")
    args = parser.parse_args()

    draft = read_assignment(Path(args.input))
    senses = read_assignment(ROOT / "public" / "word-senses.js").get("entries", {})
    entries = {}
    for word, entry in draft.get("entries", {}).items():
        source_senses = {item["id"]: item for item in senses.get(word, {}).get("senses", [])}
        if not source_senses:
            raise ValueError(f"{word}: no source senses")
        entries[word] = adapt_entry(word, entry, source_senses)

    payload = {
        "source": "Codex-authored and individually reviewed bilingual examples",
        "entries": entries,
    }
    output = Path(args.output)
    output.write_text(
        "window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(json.dumps({"importedWords": len(entries), "importedExamples": sum(len(item["examples"]) for item in entries.values())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
