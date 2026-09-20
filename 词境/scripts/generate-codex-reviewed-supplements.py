"""Codex-only incremental writer for strict bilingual shortfalls.

This wrapper reuses the local validation and append-only logic from
generate-reviewed-supplements.py, but sends no data to DeepSeek or any other
third-party model provider.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "tools" / "codex-cli" / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "bin" / "codex.exe"
DRAFTS = ROOT / "data" / "codex-cli-supplement-drafts"


def load(path: Path):
    spec = importlib.util.spec_from_file_location("supplement_tools", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


TOOLS = load(ROOT / "scripts" / "generate-reviewed-supplements.py")


def call_codex(content: str, stage: str, batch: int, model: str) -> dict:
    if not CODEX.exists():
        raise RuntimeError("project-local Codex CLI is unavailable")
    DRAFTS.mkdir(parents=True, exist_ok=True)
    stem = f"{batch:04d}-{stage}"
    prompt_path = DRAFTS / f"{stem}.prompt.txt"
    output_path = DRAFTS / f"{stem}.js"
    prompt_path.write_text(
        content + "\n\nReturn exactly one JavaScript assignment: window.REVIEWED_SUPPLEMENT_DRAFT = {\"items\":[...]};. Do not include Markdown or commentary.",
        encoding="utf-8",
    )
    if output_path.exists():
        output_path.unlink()
    command = [
        str(CODEX), "exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins", "--disable", "remote_plugin",
        "--sandbox", "read-only", "-m", model, "-C", str(ROOT), "-o", str(output_path), "-",
    ]
    with prompt_path.open("rb") as prompt_file:
        completed = subprocess.run(command, stdin=prompt_file, cwd=ROOT, capture_output=True, timeout=240)
    if completed.returncode != 0 or not output_path.exists():
        tail = (completed.stderr or completed.stdout or b"no output").decode("utf-8", errors="replace").replace("\n", " ")[-500:]
        raise RuntimeError(f"Codex {stage} pass failed: {tail}")
    return TOOLS.assignment(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Append reviewed bilingual supplements using Codex only.")
    parser.add_argument("--report", type=Path, default=TOOLS.REPORT)
    parser.add_argument("--output", type=Path, default=TOOLS.OUTPUT)
    parser.add_argument("--limit-words", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--model", default="gpt-5.6-sol")
    args = parser.parse_args()
    if args.limit_words < 1 or args.batch_size < 1:
        raise SystemExit("limits must be positive")
    report = json.loads(args.report.read_text(encoding="utf-8"))
    baseline = TOOLS.AUDIT.read_js(TOOLS.RAW)
    senses = TOOLS.AUDIT.read_js(TOOLS.SENSES)["entries"]
    reviewed = TOOLS.AUDIT.read_js(TOOLS.AUDIT.REVIEWED)["entries"] if TOOLS.AUDIT.REVIEWED.exists() else {}
    strict = TOOLS.AUDIT.read_js(TOOLS.AUDIT.STRICT_REVIEWED)["entries"] if TOOLS.AUDIT.STRICT_REVIEWED.exists() else {}
    authored = TOOLS.AUDIT.read_self_authored_entries()
    codex = TOOLS.AUDIT.read_codex_reviewed_entries()
    supplements = TOOLS.AUDIT.read_supplemental_entries()
    output_entries = TOOLS.assignment(args.output) if args.output.exists() else {}
    for word, examples in output_entries.items():
        supplements.setdefault(word, []).extend(examples)
    known_shapes = {TOOLS.shape(item.get("sentence", ""), item.get("targetForm", "")) for examples in supplements.values() for item in examples}
    requests = []
    for word in report["wordsHeldForReviewedRewrite"]:
        record = TOOLS.current(word, baseline, senses, reviewed, strict, authored, codex, supplements)
        if record and len(record["examples"]) < 5:
            requests.append(TOOLS.request_for(word, record, senses.get(word, {}).get("senses", [])))
        if len(requests) >= args.limit_words:
            break
    accepted_words = accepted_examples = 0
    unresolved = []
    for offset in range(0, len(requests), args.batch_size):
        batch = requests[offset:offset + args.batch_size]
        ordinal = offset // args.batch_size + 1
        draft = call_codex(TOOLS.prompt("Write only the missing supplement pairs.", batch), "writer", ordinal, args.model)
        reviewed_output = call_codex(TOOLS.prompt("Independently audit and replace weak draft pairs; return only missing supplements.", batch, draft), "review", ordinal, args.model)
        proposed = {str(item.get("word", "")).lower(): item for item in reviewed_output.get("items", []) if isinstance(item, dict)}
        additions, repair = {}, []
        for request in batch:
            result, errors = TOOLS.accept(request, proposed.get(request["word"]), known_shapes)
            if result is None:
                repair.append({**request, "validationErrors": errors[:8]})
            else:
                additions[request["word"]] = result
                known_shapes.update(TOOLS.shape(item["sentence"], item["targetForm"]) for item in result)
        if repair:
            repaired = call_codex(TOOLS.prompt("Repair only failed supplement requests and return complete replacements.", repair, reviewed_output), "repair", ordinal, args.model)
            repaired_by_word = {str(item.get("word", "")).lower(): item for item in repaired.get("items", []) if isinstance(item, dict)}
            for request in repair:
                result, errors = TOOLS.accept(request, repaired_by_word.get(request["word"]), known_shapes)
                if result is None:
                    unresolved.append({"word": request["word"], "errors": errors[:8]})
                else:
                    additions[request["word"]] = result
                    known_shapes.update(TOOLS.shape(item["sentence"], item["targetForm"]) for item in result)
        for word, examples in additions.items():
            output_entries.setdefault(word, []).extend(examples)
            accepted_words += 1
            accepted_examples += len(examples)
        TOOLS.write_supplement(args.output, output_entries)
        print(json.dumps({"processedWords": min(offset + len(batch), len(requests)), "requestedWords": len(requests), "acceptedWords": accepted_words, "acceptedExamples": accepted_examples, "unresolved": len(unresolved)}, ensure_ascii=False), flush=True)
    print(json.dumps({"status": "complete", "requestedWords": len(requests), "acceptedWords": accepted_words, "acceptedExamples": accepted_examples, "unresolved": unresolved}, ensure_ascii=False))


if __name__ == "__main__":
    main()
