"""Create the exact strict-rewrite queue from the all-library quality audit."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "data" / "example-quality-audit-report.json"
OUTPUT = ROOT / "data" / "strict-review-rebuild-words.json"


def main() -> None:
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    words = sorted({str(word).strip().lower() for word in audit.get("wordsHeldForReviewedRewrite", []) if str(word).strip()})
    OUTPUT.write_text(json.dumps({
        "reason": "Every word in this queue had no sentence that passed the strict bilingual release gate.",
        "requiredStandard": "Five self-contained, logical, natural English-Chinese examples suitable for graduate entrance exams and IELTS.",
        "words": words,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"words": len(words), "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
