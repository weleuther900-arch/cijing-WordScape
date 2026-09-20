"""Solve the remaining POS-sensitive words with one Codex generation per word."""
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


BASE = load("direct_base", ROOT / "scripts" / "generate-direct-sense-supplements.py")
TOOLS = BASE.TOOLS


def prompt(request: dict, required_ids: dict[str, list[str]]) -> str:
    return json.dumps({
        "task": "Write only the missing bilingual examples for this one word.",
        "word": request["word"], "requestedCount": request["requestedCount"],
        "sourceSenses": request["sourceSenses"], "retainedExamples": request["retainedExamples"],
        "mandatory": {"requiredPartToAllowedSenseIds": required_ids, "instruction": "Every listed part must appear in the result with a senseId chosen exactly from its allowed IDs. Do not use any other part instead."},
        "rules": [
            "Return exactly requestedCount new examples; do not alter or repeat retainedExamples.",
            "Each item has sentence, translation, targetForm, and senseId. senseId must be exactly a supplied source ID.",
            "English must be a natural self-contained 10-26-word declarative sentence with one final period and the literal targetForm.",
            "Chinese must be one concise, idiomatic, accurate Simplified-Chinese sentence ending in 。.",
            "Use an exam-appropriate, non-template context. Silently check grammar, logic, and collocation before answering.",
        ],
        "returnShape": {"items": [{"word": request["word"], "examples": [{"sentence": "English", "translation": "中文。", "targetForm": "in English", "senseId": "supplied ID"}]}]},
    }, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-words", type=int, default=20)
    parser.add_argument("--model", default="gpt-5.6-terra")
    args = parser.parse_args()
    report = json.loads(TOOLS.REPORT.read_text(encoding="utf-8"))
    baseline, senses = TOOLS.AUDIT.read_js(TOOLS.RAW), TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    reviewed = TOOLS.AUDIT.read_js(TOOLS.AUDIT.REVIEWED)["entries"] if TOOLS.AUDIT.REVIEWED.exists() else {}
    strict = TOOLS.AUDIT.read_js(TOOLS.AUDIT.STRICT_REVIEWED)["entries"] if TOOLS.AUDIT.STRICT_REVIEWED.exists() else {}
    authored, codex, supplements = TOOLS.AUDIT.read_self_authored_entries(), TOOLS.AUDIT.read_codex_reviewed_entries(), TOOLS.AUDIT.read_supplemental_entries()
    output = ROOT / "data" / "self-authored-supplements-018.js"
    entries = TOOLS.assignment(output) if output.exists() else {}
    for word, examples in entries.items(): supplements.setdefault(word, []).extend(examples)
    shapes = {TOOLS.shape(item.get("sentence", ""), item.get("targetForm", "")) for values in supplements.values() for item in values}
    accepted = unresolved = 0
    for word in report["wordsHeldForReviewedRewrite"]:
        record = TOOLS.current(word, baseline, senses, reviewed, strict, authored, codex, supplements)
        if not record or len(record["examples"]) >= 5: continue
        request = TOOLS.request_for(word, record, senses.get(word, {}).get("senses", []))
        ids = {}
        for sense in request["sourceSenses"]:
            part = str(sense.get("partOfSpeech", "")).lower().rstrip(".")
            if part in request["mustCoverParts"]: ids.setdefault(part, []).append(str(sense["id"]))
        payload = BASE.call_codex(prompt(request, ids), accepted + unresolved + 1, args.model)
        rows = {str(item.get("word", "")).lower(): item for item in payload.get("items", []) if isinstance(item, dict)}
        result, errors = BASE.accept(request, rows.get(word), shapes)
        if result is None:
            unresolved += 1
        else:
            entries.setdefault(word, []).extend(result)
            shapes.update(TOOLS.shape(item["sentence"], item["targetForm"]) for item in result)
            accepted += 1
        TOOLS.write_supplement(output, entries)
        print(json.dumps({"processed": accepted + unresolved, "accepted": accepted, "unresolved": unresolved, "word": word}, ensure_ascii=False), flush=True)
        if accepted + unresolved >= args.limit_words: break


if __name__ == "__main__":
    main()
