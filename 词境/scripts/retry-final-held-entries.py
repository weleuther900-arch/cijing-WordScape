"""Write complete direct records for the final held words without touching released entries."""
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


SINGLE = load("final_pos_complete", ROOT / "scripts" / "generate-pos-complete-entries.py")
BASE = SINGLE.BASE
TOOLS = SINGLE.TOOLS
OUTPUT = ROOT / "data" / "self-authored-examples-024.js"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--limit-words", type=int, default=9)
    args = parser.parse_args()
    report = json.loads(TOOLS.REPORT.read_text(encoding="utf-8"))
    senses = TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    existing = {}
    if OUTPUT.exists():
        payload = json.loads(OUTPUT.read_text(encoding="utf-8-sig").split("=", 1)[1].strip().rstrip(";"))
        existing = payload.get("entries", {})
    accepted = rejected = 0
    for word in report["wordsHeldForReviewedRewrite"]:
        if word in existing:
            continue
        word_senses = senses[word]["senses"]
        payload = BASE.call_codex(SINGLE.prompt(word, word_senses, sorted({str(x.get("partOfSpeech", "")).lower().rstrip(".") for x in word_senses})), 30000 + accepted + rejected, args.model)
        items = {str(x.get("word", "")).lower(): x for x in payload.get("items", []) if isinstance(x, dict)}
        result = SINGLE.validate(word, word_senses, items.get(word))
        if result is None:
            rejected += 1
        else:
            existing[word] = result
            accepted += 1
        if accepted + rejected >= args.limit_words:
            break
    OUTPUT.write_text("window.SELF_AUTHORED_EXAMPLES_024 = " + json.dumps({"entries": existing}, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"accepted": accepted, "rejected": rejected, "stored": len(existing)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
