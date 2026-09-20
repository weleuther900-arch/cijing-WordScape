"""Normalize direct records from the POS-complete batch into {entries: ...}."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "self-authored-examples-020.js"
OUTPUT = ROOT / "data" / "self-authored-examples-021.js"

raw = SOURCE.read_text(encoding="utf-8-sig")
payload = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
entries = {word: examples for word, examples in payload.items() if isinstance(examples, list)}
OUTPUT.write_text("window.SELF_AUTHORED_EXAMPLES_021 = " + json.dumps({"entries": entries}, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print(json.dumps({"words": len(entries), "output": str(OUTPUT)}, ensure_ascii=False))
