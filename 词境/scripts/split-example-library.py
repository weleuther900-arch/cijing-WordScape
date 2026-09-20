"""Split the validated full example library into phone-friendly two-letter shards."""
from __future__ import annotations

import json
import shutil
from argparse import ArgumentParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "corpus-backed-examples.js"
OUT = ROOT / "public" / "ai-examples"
INDEX = ROOT / "public" / "ai-example-index.js"
FULL = ROOT / "public" / "ai-examples-full.js"
RELEASED_INDEX = ROOT / "public" / "released-example-words.js"


def main() -> None:
    parser = ArgumentParser(description="Split an example library into phone-friendly two-letter shards.")
    parser.add_argument("--source", type=Path, default=SOURCE, help="Source file, relative to the 词境 directory unless absolute.")
    args = parser.parse_args()
    source = args.source if args.source.is_absolute() else ROOT / args.source
    raw = source.read_text(encoding="utf-8")
    payload = json.loads(raw.split("window.WORD_AI_EXAMPLE_LIBRARY =", 1)[1].strip().rstrip(";"))
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    buckets: dict[str, dict] = {}
    for word, entry in payload["entries"].items():
        normalized = word.lower()
        key = normalized[:2] if len(normalized) >= 2 and normalized[:2].isalpha() else (normalized[:1] if normalized[:1].isalpha() else "other")
        buckets.setdefault(key, {})[word] = entry
    index = {}
    for key, entries in sorted(buckets.items()):
        filename = f"{key}.js"
        shard = {"entries": entries}
        (OUT / filename).write_text("window.WORD_AI_EXAMPLE_CHUNK = " + json.dumps(shard, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        index[key] = f"./ai-examples/{filename}"
    INDEX.write_text("window.WORD_AI_EXAMPLE_INDEX = " + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    RELEASED_INDEX.write_text(
        "window.WORD_RELEASED_EXAMPLE_WORDS = "
        + json.dumps(sorted(str(word).lower() for word in payload["entries"]), ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    # Keep a canonical local copy for verification and recovery.  It is removed
    # from the iOS deployment package because the app streams the small shards.
    FULL.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"source": str(source), "shards": len(index), "words": len(payload["entries"]), "examples": sum(len(v["examples"]) for v in payload["entries"].values())}))


if __name__ == "__main__":
    main()
