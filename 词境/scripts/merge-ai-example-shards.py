"""Merge completed DeepSeek example shards into the static PWA library.

The generator writes one independent file per shard so a long offline build can
run in parallel without any file races. This merger refuses incomplete output.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOK_PATH = ROOT / "public" / "bundled-imports" / "27-one.json"


def read_library(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    marker = "window.WORD_AI_EXAMPLE_LIBRARY ="
    if marker not in text:
        raise ValueError(f"{path.name} does not define WORD_AI_EXAMPLE_LIBRARY")
    return json.loads(text.split(marker, 1)[1].strip().rstrip(";"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shard-count", type=int, default=4)
    parser.add_argument("--input-pattern", default="public/ai-example-library.part-{index}.js")
    parser.add_argument("--output", default="public/ai-example-library.js")
    args = parser.parse_args()

    expected_words = [str(word).lower() for word in json.loads(BOOK_PATH.read_text(encoding="utf-8"))["words"]]
    merged: dict[str, dict] = {}
    models: set[str] = set()
    for index in range(args.shard_count):
        path = ROOT / args.input_pattern.format(index=index)
        if not path.exists():
            raise SystemExit(f"missing shard file: {path}")
        payload = read_library(path)
        models.add(str(payload.get("model", "unknown")))
        for word, item in payload.get("entries", {}).items():
            if word in merged:
                raise SystemExit(f"duplicate word across shards: {word}")
            examples = item.get("examples", [])
            if len(examples) != 5:
                raise SystemExit(f"{word} has {len(examples)} examples; expected 5")
            merged[word] = item

    missing = [word for word in expected_words if word not in merged]
    extras = [word for word in merged if word not in set(expected_words)]
    if missing or extras:
        raise SystemExit(json.dumps({"missing": missing[:20], "missingCount": len(missing), "extra": extras[:20], "extraCount": len(extras)}, ensure_ascii=False))

    output = {
        "source": "DeepSeek offline generation: writer, language review, memory-writing review, and local hard validation",
        "model": ", ".join(sorted(models)),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entries": merged,
    }
    out_path = ROOT / args.output
    out_path.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(output, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"status": "complete", "words": len(merged), "examples": len(merged) * 5, "output": str(out_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
