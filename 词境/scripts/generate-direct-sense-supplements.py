"""Codex-only incremental writer using dictionary source-sense IDs directly."""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "tools" / "codex-cli" / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "bin" / "codex.exe"
DRAFTS = ROOT / "data" / "codex-cli-direct-sense-drafts"


def load(path: Path):
    spec = importlib.util.spec_from_file_location("supplement_tools", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


TOOLS = load(ROOT / "scripts" / "generate-reviewed-supplements.py")


def assignment(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig").split("=", 1)[1].strip().rstrip(";"))


def call_codex(content: str, ordinal: int, model: str) -> dict:
    DRAFTS.mkdir(parents=True, exist_ok=True)
    prompt_path = DRAFTS / f"{ordinal:04d}.prompt.txt"
    output_path = DRAFTS / f"{ordinal:04d}.js"
    prompt_path.write_text(content + "\n\nReturn exactly: window.DIRECT_SENSE_DRAFT = {\"items\":[...]};. No Markdown or commentary.", encoding="utf-8")
    if output_path.exists():
        output_path.unlink()
    command = [str(CODEX), "exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins", "--disable", "remote_plugin", "--sandbox", "read-only", "-m", model, "-C", str(ROOT), "-o", str(output_path), "-"]
    with prompt_path.open("rb") as source:
        completed = subprocess.run(command, stdin=source, cwd=ROOT, capture_output=True, timeout=180)
    if completed.returncode != 0 or not output_path.exists():
        detail = (completed.stderr or completed.stdout or b"no output").decode("utf-8", errors="replace").replace("\n", " ")[-300:]
        raise RuntimeError(f"Codex direct-sense call failed: {detail}")
    return assignment(output_path)


def direct_prompt(items: list[dict]) -> str:
    return json.dumps({
        "task": "Write only the requested missing bilingual pairs. Return source sense IDs directly; do not create sense groups.",
        "rules": [
            "For each word, return exactly requestedCount new examples. Do not repeat or alter retainedExamples.",
            "Each example's senseId must be exactly one id from that word's sourceSenses. Never invent, rename, merge, or number an ID.",
            "Cover every mustCoverParts item using the matching source sense part of speech.",
            "English: one concise, logical, self-contained declarative sentence, 10-26 words, capitalized, ending in one period; targetForm must occur literally and naturally.",
            "Chinese: one concise, idiomatic Simplified-Chinese sentence accurately translating the full English sentence, ending in 。.",
            "Use natural graduate-exam/IELTS contexts. No template, dialogue, quotation, question, exclamation, invented statistic, or filler.",
        ],
        "returnShape": {"items": [{"word": "exact", "examples": [{"sentence": "English", "translation": "中文。", "targetForm": "exact in sentence", "senseId": "one supplied source ID"}]}]},
        "items": items,
    }, ensure_ascii=False)


def accept(request: dict, raw: object, known_shapes: set[str]) -> tuple[list[dict] | None, list[str]]:
    if not isinstance(raw, dict):
        return None, ["missing result"]
    source = {str(item["id"]): item for item in request["sourceSenses"]}
    groups = {sense_id: {"id": sense_id, "partOfSpeech": item["partOfSpeech"]} for sense_id, item in source.items()}
    retained = request["retainedExamples"]
    chosen, errors = [], []
    retained_text = {TOOLS.norm(item["sentence"]) for item in retained}
    shapes = set(known_shapes)
    for item in raw.get("examples", []):
        sense_id = str(item.get("senseId", ""))
        valid, reason = TOOLS.TOOLS.strictly_valid(request["word"], {**item, "senseId": sense_id}, set(groups))
        if not valid:
            errors.append(reason)
            continue
        sentence, form = str(item["sentence"]).strip(), str(item.get("targetForm", "")).strip()
        pair_shape = TOOLS.shape(sentence, form)
        if TOOLS.norm(sentence) in retained_text:
            errors.append("repeats retained sentence")
        elif TOOLS.TOOLS.near_duplicate(sentence, request["word"], retained + chosen):
            errors.append("near duplicate")
        elif pair_shape in shapes:
            errors.append("cross-word template")
        else:
            chosen.append({"sentence": sentence, "translation": str(item["translation"]).strip(), "targetForm": form, "senseId": sense_id})
            shapes.add(pair_shape)
        if len(chosen) == request["requestedCount"]:
            break
    if len(chosen) != request["requestedCount"]:
        return None, errors
    covered = {str(source[item["senseId"]]["partOfSpeech"]).lower().rstrip(".") for item in chosen}
    missing = set(request["mustCoverParts"]) - covered
    return (None, errors + ["missing POS: " + ",".join(sorted(missing))]) if missing else (chosen, errors)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-words", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--model", default="gpt-5.6-terra")
    args = parser.parse_args()
    report = json.loads(TOOLS.REPORT.read_text(encoding="utf-8"))
    baseline, senses = TOOLS.AUDIT.read_js(TOOLS.RAW), TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    reviewed = TOOLS.AUDIT.read_js(TOOLS.AUDIT.REVIEWED)["entries"] if TOOLS.AUDIT.REVIEWED.exists() else {}
    strict = TOOLS.AUDIT.read_js(TOOLS.AUDIT.STRICT_REVIEWED)["entries"] if TOOLS.AUDIT.STRICT_REVIEWED.exists() else {}
    authored, codex, supplements = TOOLS.AUDIT.read_self_authored_entries(), TOOLS.AUDIT.read_codex_reviewed_entries(), TOOLS.AUDIT.read_supplemental_entries()
    output = ROOT / "data" / "self-authored-supplements-017.js"
    entries = TOOLS.assignment(output) if output.exists() else {}
    for word, examples in entries.items(): supplements.setdefault(word, []).extend(examples)
    shapes = {TOOLS.shape(item.get("sentence", ""), item.get("targetForm", "")) for examples in supplements.values() for item in examples}
    requests = []
    for word in report["wordsHeldForReviewedRewrite"]:
        record = TOOLS.current(word, baseline, senses, reviewed, strict, authored, codex, supplements)
        if record and len(record["examples"]) < 5:
            requests.append(TOOLS.request_for(word, record, senses.get(word, {}).get("senses", [])))
        if len(requests) >= args.limit_words: break
    done_words = done_examples = 0
    unresolved = []
    for offset in range(0, len(requests), args.batch_size):
        batch = requests[offset:offset + args.batch_size]
        payload = call_codex(direct_prompt(batch), offset // args.batch_size + 1, args.model)
        rows = {str(item.get("word", "")).lower(): item for item in payload.get("items", []) if isinstance(item, dict)}
        for request in batch:
            result, errors = accept(request, rows.get(request["word"]), shapes)
            if result is None:
                unresolved.append({"word": request["word"], "errors": errors[:5]})
            else:
                entries.setdefault(request["word"], []).extend(result)
                done_words += 1; done_examples += len(result)
                shapes.update(TOOLS.shape(item["sentence"], item["targetForm"]) for item in result)
        TOOLS.write_supplement(output, entries)
        print(json.dumps({"processedWords": min(offset + len(batch), len(requests)), "acceptedWords": done_words, "acceptedExamples": done_examples, "unresolved": len(unresolved)}, ensure_ascii=False), flush=True)
    print(json.dumps({"acceptedWords": done_words, "acceptedExamples": done_examples, "unresolved": unresolved}, ensure_ascii=False))


if __name__ == "__main__":
    main()
