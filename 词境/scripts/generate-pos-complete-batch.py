"""Generate complete five-example records for up to 20 held multi-POS words in one Codex call."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


SINGLE = load("pos_complete_single", ROOT / "scripts" / "generate-pos-complete-entries.py")
BASE = SINGLE.BASE
TOOLS = SINGLE.TOOLS


def item(word: str, senses: list[dict]) -> dict:
    parts = {}
    for sense in senses:
        part = str(sense.get("partOfSpeech", "")).lower().rstrip(".")
        if part in {"n", "v", "adj", "adv", "pron", "conj", "prep"}:
            parts.setdefault(part, []).append(str(sense["id"]))
    return {"word": word, "sourceSenses": senses, "mandatoryPartToSenseIds": parts}


def prompt(items: list[dict]) -> str:
    return json.dumps({
        "task": "For every supplied word, write exactly five final bilingual examples.",
        "rules": [
            "Return each supplied word exactly once with exactly five examples. Cover every mandatory part using one of its listed sense IDs.",
            "Use only supplied source sense IDs. Every example has sentence, translation, targetForm, senseId.",
            "English is a concise, self-contained, idiomatic declarative sentence of 10-26 words, capitalized and ending in one period; targetForm occurs literally and naturally.",
            "Chinese is one concise, idiomatic, faithful Simplified-Chinese sentence ending in 。.",
            "Use varied natural graduate-exam/IELTS contexts. No template, dialogue, quotation, question, exclamation, filler, or invented fact."
        ],
        "returnShape": {"items": [{"word": "exact", "examples": [{"sentence": "English", "translation": "中文。", "targetForm": "in English", "senseId": "supplied ID"}]}]},
        "items": items,
    }, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-words", type=int, default=20)
    parser.add_argument("--model", default="gpt-5.6-terra")
    args = parser.parse_args()
    report = json.loads(TOOLS.REPORT.read_text(encoding="utf-8"))
    sense_entries = TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    output = ROOT / "data" / "self-authored-examples-020.js"
    entries = TOOLS.assignment(output) if output.exists() else {}
    selected: list[tuple[str, list[dict]]] = []
    for word in report["wordsHeldForReviewedRewrite"]:
        if word in entries:
            continue
        senses = sense_entries.get(word, {}).get("senses", [])
        parts = {str(x.get("partOfSpeech", "")).lower().rstrip(".") for x in senses}
        if len(parts & {"n", "v", "adj", "adv", "pron", "conj", "prep"}) >= 2:
            selected.append((word, senses))
        if len(selected) >= args.limit_words:
            break
    if not selected:
        print(json.dumps({"processed": 0, "accepted": 0, "rejected": 0}, ensure_ascii=False))
        return
    payload = BASE.call_codex(prompt([item(word, senses) for word, senses in selected]), len(entries) + 10000, args.model)
    returned = {str(x.get("word", "")).lower(): x for x in payload.get("items", []) if isinstance(x, dict)}
    accepted = rejected = 0
    for word, senses in selected:
        examples = SINGLE.validate(word, senses, returned.get(word))
        if examples is None:
            rejected += 1
        else:
            entries[word] = examples
            accepted += 1
    TOOLS.write_supplement(output, entries)
    print(json.dumps({"processed": len(selected), "accepted": accepted, "rejected": rejected}, ensure_ascii=False))


if __name__ == "__main__":
    main()
