"""Rebuild only held words whose retained pairs cannot meet required POS coverage."""
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


def prompt(word: str, senses: list[dict], required_parts: list[str]) -> str:
    by_part = {}
    for sense in senses:
        part = str(sense.get("partOfSpeech", "")).lower().rstrip(".")
        if part in required_parts: by_part.setdefault(part, []).append(str(sense["id"]))
    return json.dumps({
        "task": "Write a complete final set of exactly five bilingual examples for this word.",
        "word": word, "sourceSenses": senses, "mandatoryPartToSenseIds": by_part,
        "rules": [
            "Return exactly five examples. Every mandatory part must be represented by an example using exactly one listed source sense ID for that part.",
            "Use only supplied source sense IDs; never invent or rename IDs. Each example has sentence, translation, targetForm, senseId.",
            "English: concise, self-contained, idiomatic declarative sentence of 10-26 words, one final period, literal natural targetForm.",
            "Chinese: one concise, idiomatic, faithful Simplified-Chinese sentence ending in 。.",
            "Vary contexts and structures. Use natural graduate-exam/IELTS contexts; no template, dialogue, quotation, question, exclamation, filler, or invented fact.",
        ],
        "returnShape": {"items": [{"word": word, "examples": [{"sentence": "English", "translation": "中文。", "targetForm": "in English", "senseId": "supplied ID"}]}]},
    }, ensure_ascii=False)


def validate(word: str, senses: list[dict], raw: object) -> list[dict] | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("examples"), list): return None
    source = {str(item["id"]): item for item in senses}
    groups = {key: {"id": key, "partOfSpeech": value["partOfSpeech"]} for key, value in source.items()}
    chosen = []
    for item in raw["examples"]:
        valid, _ = TOOLS.TOOLS.strictly_valid(word, item, set(groups))
        if not valid or str(item.get("senseId", "")) not in source: continue
        if TOOLS.TOOLS.near_duplicate(str(item["sentence"]), word, chosen): continue
        chosen.append({key: item[key] for key in ("sentence", "translation", "targetForm", "senseId")})
        if len(chosen) == 5: break
    if len(chosen) != 5: return None
    required = {str(item.get("partOfSpeech", "")).lower().rstrip(".") for item in senses if str(item.get("partOfSpeech", "")).lower().rstrip(".") in {"n", "v", "adj", "adv", "pron", "conj", "prep"}}
    covered = {str(source[item["senseId"]]["partOfSpeech"]).lower().rstrip(".") for item in chosen}
    return chosen if required <= covered else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-words", type=int, default=20)
    parser.add_argument("--model", default="gpt-5.6-terra")
    args = parser.parse_args()
    report = json.loads(TOOLS.REPORT.read_text(encoding="utf-8"))
    senses = TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    output = ROOT / "data" / "self-authored-examples-020.js"
    entries = TOOLS.assignment(output) if output.exists() else {}
    accepted = rejected = 0
    for word in report["wordsHeldForReviewedRewrite"]:
        if word in entries: continue
        word_senses = senses.get(word, {}).get("senses", [])
        needed_parts = {str(item.get("partOfSpeech", "")).lower().rstrip(".") for item in word_senses if str(item.get("partOfSpeech", "")).lower().rstrip(".") in {"n", "v", "adj", "adv", "pron", "conj", "prep"}}
        if len(needed_parts) < 2: continue
        payload = BASE.call_codex(prompt(word, word_senses, sorted(needed_parts)), accepted + rejected + 1, args.model)
        items = {str(item.get("word", "")).lower(): item for item in payload.get("items", []) if isinstance(item, dict)}
        result = validate(word, word_senses, items.get(word))
        if result is None: rejected += 1
        else: entries[word] = result; accepted += 1
        TOOLS.write_supplement(output, entries)
        print(json.dumps({"processed": accepted + rejected, "accepted": accepted, "rejected": rejected, "word": word}, ensure_ascii=False), flush=True)
        if accepted + rejected >= args.limit_words: break


if __name__ == "__main__":
    main()
