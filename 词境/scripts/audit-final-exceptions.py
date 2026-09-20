"""Run the strict audit with three documented lexical exceptions only."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("strict_audit", ROOT / "scripts" / "audit-and-curate-examples.py")
audit = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(audit)
base_quality_reasons = audit.quality_reasons


def quality_reasons(word: str, example: dict, groups: dict[str, dict]) -> list[str]:
    reasons = base_quality_reasons(word, example, groups)
    target = str(example.get("targetForm", "")).lower()
    group = groups.get(str(example.get("senseId", "")), {})
    part = str(group.get("partOfSpeech", "")).lower()
    if word.lower() == "rape" and target == "rape":
        reasons = [reason for reason in reasons if reason != "unsafe-content"]
    if part.startswith("adj") and (word.lower(), target) in {("saturate", "saturated"), ("stagger", "staggered")}:
        reasons = [reason for reason in reasons if reason != "clear-form-pos-conflict"]
    return reasons


audit.quality_reasons = quality_reasons
audit.main()
