"""Identify legacy template examples that need human-quality regeneration.

The earlier coverage builder guaranteed five structurally valid sentences for
every word.  Its last-resort templates are grammatically formed but sometimes
semantically implausible (for example, treating a *curtain* like a policy
issue).  This audit never changes the corpus; it produces a precise queue for
the bilingual writer/reviewer pass.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "corpus-backed-examples.js"
OUTPUT = ROOT / "data" / "example-quality-refresh-words.json"

TEMPLATE = re.compile(
    r"seemed peripheral at first|earlier discussions had overlooked|"
    r"provided a useful basis for a more balanced decision|"
    r"clear account of .+final recommendation|remained relevant throughout the inquiry|"
    r"result appeared .+committee requested further evidence|"
    r"panel considered the proposal .+concerns raised during consultation|"
    r"evidence became .+researchers explained its limitations|"
    r"approach is more persuasive when it is supported by transparent reasoning|"
    r"report remained .+central argument easier for readers|"
    r"evidence was incomplete, the committee considered how to|"
    r"new information emerged, the panel had to .+rather than rely on an earlier assumption|"
    r"researchers chose to .+only after they had checked|"
    r"clear criteria, it is difficult to .+other readers can evaluate fairly|"
    r"report explains why the team decided to .+reasoning more transparent|"
    r"committee responded .+evidence required a clear explanation for the public|"
    r"issue was complex, the report addressed it .+unsupported claims|"
    r"new findings appeared, the researchers adjusted their interpretation .+rather than hastily|"
    r"panel explained its decision .+readers follow the argument step by step|"
    r"reliable data, officials cannot act .+public confidence in the process|"
    r"report used .+connected the main argument with evidence|"
    r"topic was complex, the writer used .+relationship between two ideas clear|"
    r"readers encounter .+how it shapes the logic of the surrounding sentence|"
    r"editor retained .+argument more precise without making the style needlessly formal|"
    r"without .+transition between the two claims would have been less clear",
    re.IGNORECASE,
)


def read_library(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    return json.loads(raw.split("window.WORD_AI_EXAMPLE_LIBRARY =", 1)[1].strip().rstrip(";"))


def main() -> None:
    entries = read_library(SOURCE)["entries"]
    flagged: dict[str, int] = {}
    for word, record in entries.items():
        count = sum(bool(TEMPLATE.search(str(example.get("sentence", "")))) for example in record.get("examples", []))
        if count:
            flagged[word] = count
    payload = {
        "reason": "Legacy grammatical templates with weak word-to-context fit; replace with reviewed sense-linked examples.",
        "words": sorted(flagged),
        "templateExamples": sum(flagged.values()),
        "affectedWords": len(flagged),
        "perWordTemplateCounts": dict(sorted(flagged.items())),
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"affectedWords": payload["affectedWords"], "templateExamples": payload["templateExamples"], "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
