"""Resolve every published bilingual example to one exact dictionary sense.

The prior library grouped multiple same-part-of-speech meanings together. That
was acceptable as generation metadata but unsafe for learner-facing sentence
cards, where it made every group look like the meaning of one sentence.

This tool uses a constrained semantic review: each example may select only an
existing source-sense ID from its original group. It then writes an atomic
group per selected source sense. Progress is resumable and the final library is
never written until every source record has a validated mapping.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "corpus-backed-examples.js"
DEFAULT_OUTPUT = ROOT / "data" / "context-resolved-examples.js"
DEFAULT_PROGRESS = ROOT / "data" / "context-sense-resolution-progress.json"
DRAFTS = ROOT / "data" / "context-sense-review-drafts"
CODEX = ROOT / "tools" / "codex-cli" / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "bin" / "codex.exe"


# Stable, sentence-level repairs for legacy annotations where the original
# group part of speech conflicts with the actual sentence context.
MANUAL_CONTEXT_OVERRIDES = {
    "a": {
        "0": "other-2",
        "1": "other-2",
        "2": "other-2",
    },
    "sun": {
        "0": "n-1",
        "1": "n-1",
        "2": "n-4",
        "3": "n-4",
        "4": "n-4",
    },
}

MANUAL_CONTEXT_EXCLUSIONS = {
    "a": {3},
}


def read_assignment(path: Path, variable: str) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    marker = f"window.{variable} ="
    if marker not in text:
        raise ValueError(f"{path} does not define {variable}")
    return json.loads(text.split(marker, 1)[1].strip().rstrip(";"))


def decode_json(text: str) -> dict:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("review output did not contain a JSON object")


def write_assignment(path: Path, payload: dict) -> None:
    path.write_text(
        "window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def load_progress(path: Path, restart: bool) -> dict:
    if restart or not path.exists():
        return {"mappings": {}, "failures": {}}
    value = json.loads(path.read_text(encoding="utf-8"))
    return {"mappings": value.get("mappings", {}), "failures": value.get("failures", {})}


def save_progress(path: Path, progress: dict) -> None:
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def group_map(record: dict) -> dict[str, dict]:
    return {str(group.get("id", "")): group for group in record.get("senseGroups", []) if isinstance(group, dict)}


def clean_glosses(value: object) -> list[str]:
    return [piece.strip() for piece in str(value or "").replace("；", ";").split(";") if piece.strip()]


def source_inventory(word: str, record: dict, library: dict) -> dict[str, dict]:
    known = {str(sense.get("id", "")): dict(sense) for sense in library.get(word, {}).get("senses", [])}
    inventory: dict[str, dict] = {}
    for group in record.get("senseGroups", []):
        if not isinstance(group, dict):
            continue
        ids = [str(value) for value in group.get("sourceSenseIds", []) if str(value)]
        glosses = clean_glosses(group.get("sense", ""))
        missing = [source_id for source_id in ids if source_id not in known]
        fallback: dict[str, str] = {}
        if len(glosses) == len(ids):
            fallback = dict(zip(ids, glosses))
        elif len(glosses) == len(missing):
            fallback = dict(zip(missing, glosses))
        elif len(glosses) == 1:
            fallback = {source_id: glosses[0] for source_id in missing}
        else:
            fallback = {source_id: str(group.get("sense", "")).strip() for source_id in missing}
        for source_id in ids:
            if source_id in known:
                inventory[source_id] = known[source_id]
            elif source_id:
                inventory[source_id] = {
                    "id": source_id,
                    "partOfSpeech": str(group.get("partOfSpeech", "")),
                    "sense": fallback.get(source_id, str(group.get("sense", "")).strip()),
                    "legacySource": True,
                }
    return inventory


def part_key(value: object) -> str:
    return str(value or "").strip().lower().rstrip(".")


def available_for_group(group: dict, inventory: dict[str, dict]) -> list[dict]:
    ids = [str(value) for value in group.get("sourceSenseIds", [])]
    original = [inventory[source_id] for source_id in ids if source_id in inventory]
    # A singleton source group is already precise. For a merged group, offer
    # every dictionary sense with the same part of speech: legacy metadata can
    # itself be wrong (for example a context tagged "迟钝" may mean "迟缓").
    if len(original) == 1:
        return original
    matched_part = [sense for sense in inventory.values() if part_key(sense.get("partOfSpeech")) == part_key(group.get("partOfSpeech"))]
    return matched_part or original


def review_request(word: str, record: dict, library: dict) -> tuple[dict | None, dict[str, str], str]:
    groups = group_map(record)
    inventory = source_inventory(word, record, library)
    source_by_id: OrderedDict[str, dict] = OrderedDict()
    examples = []
    direct: dict[str, str] = {}
    for index, example in enumerate(record.get("examples", [])):
        group = groups.get(str(example.get("senseId", "")))
        if group is None:
            return None, {}, "example has no source group"
        available = available_for_group(group, inventory)
        if not available:
            return None, {}, "source group has no usable dictionary senses"
        allowed_ids = [str(sense["id"]) for sense in available]
        for sense in available:
            source_by_id.setdefault(str(sense["id"]), sense)
        if len(allowed_ids) == 1:
            direct[str(index)] = allowed_ids[0]
            continue
        examples.append({
            "index": index,
            "sentence": str(example.get("sentence", "")).strip(),
            "translation": str(example.get("translation", "")).strip(),
            "allowedSourceSenseIds": allowed_ids,
        })
    if not examples:
        return None, direct, ""
    return {
        "word": word,
        "sourceSenses": list(source_by_id.values()),
        "examples": examples,
    }, direct, ""


def prompt(items: list[dict]) -> str:
    return json.dumps({
        "task": "For every listed bilingual sentence, select exactly one sourceSenseId that is the meaning of the target word in that sentence.",
        "rules": [
            "Use the Chinese translation and the English sentence together. Choose the ordinary contextual meaning, not every dictionary meaning of the word.",
            "Each example can use only one of its allowedSourceSenseIds. Never invent, rename, merge, or omit an ID.",
            "If source senses are close, choose the most specific sense justified by the sentence. Do not select an unrelated homonym, technical meaning, or a different part of speech.",
            "Return every supplied index exactly once. Return JSON only.",
        ],
        "returnShape": {"items": [{"word": "exact word", "examples": [{"index": 0, "sourceSenseId": "one allowed ID"}]}]},
        "items": items,
    }, ensure_ascii=False)


def call_reviewer(payload: list[dict], ordinal: int, model: str) -> dict:
    reviewer = str(CODEX) if CODEX.exists() else shutil.which("codex")
    if not reviewer:
        raise RuntimeError("reviewer is missing: install Codex CLI or restore the project tool cache")
    DRAFTS.mkdir(parents=True, exist_ok=True)
    output = DRAFTS / f"{ordinal:04d}.json"
    command = [
        reviewer, "exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins",
        "--disable", "remote_plugin", "--sandbox", "read-only", "-m", model, "-C", str(ROOT),
        "-o", str(output), "-",
    ]
    completed = subprocess.run(
        command, input=prompt(payload).encode("utf-8"), cwd=ROOT, capture_output=True, timeout=300
    )
    if completed.returncode != 0 or not output.exists():
        detail = (completed.stderr or completed.stdout or b"no output").decode("utf-8", errors="replace").replace("\n", " ")[-500:]
        raise RuntimeError(f"reviewer failed: {detail}")
    return decode_json(output.read_text(encoding="utf-8-sig"))


def validate_response(requests: dict[str, dict], response: dict) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    by_word = {str(item.get("word", "")).lower(): item for item in response.get("items", []) if isinstance(item, dict)}
    accepted: dict[str, dict[str, str]] = {}
    failures: dict[str, str] = {}
    for word, request in requests.items():
        row = by_word.get(word)
        expected = {str(example["index"]): set(example["allowedSourceSenseIds"]) for example in request["examples"]}
        selected: dict[str, str] = {}
        if not isinstance(row, dict):
            failures[word] = "review response omitted word"
            continue
        for example in row.get("examples", []):
            index = str(example.get("index", ""))
            source_id = str(example.get("sourceSenseId", ""))
            if index in expected and source_id in expected[index] and index not in selected:
                selected[index] = source_id
        if set(selected) != set(expected):
            failures[word] = "review response had an invalid, duplicate, or missing sense selection"
            continue
        accepted[word] = selected
    return accepted, failures


def atomize(word: str, record: dict, mapping: dict[str, str], library: dict) -> dict | None:
    groups = group_map(record)
    all_senses = source_inventory(word, record, library)
    groups_out: OrderedDict[str, dict] = OrderedDict()
    examples_out = []
    for index, example in enumerate(record.get("examples", [])):
        if index in MANUAL_CONTEXT_EXCLUSIONS.get(word, set()):
            continue
        source_id = mapping.get(str(index), "")
        source = all_senses.get(source_id)
        original = groups.get(str(example.get("senseId", "")))
        if not source or not original:
            return None
        group_id = f"source-{source_id}"
        if group_id not in groups_out:
            reviewed_group = {
                "id": group_id,
                "partOfSpeech": str(source.get("partOfSpeech", "")),
                "sourceSenseIds": [source_id],
                "sense": str(source.get("sense", "")),
            }
            if source.get("legacySource"):
                reviewed_group["contextReviewed"] = True
            groups_out[group_id] = reviewed_group
        examples_out.append({
            "sentence": str(example.get("sentence", "")).strip(),
            "translation": str(example.get("translation", "")).strip(),
            "targetForm": str(example.get("targetForm", word)).strip(),
            "senseId": group_id,
            "sourceSenseId": source_id,
        })
    return {"senseGroups": list(groups_out.values()), "examples": examples_out}


def main() -> None:
    parser = argparse.ArgumentParser(description="Atomize published example meanings through constrained bilingual review.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--progress", type=Path, default=DEFAULT_PROGRESS)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--limit-batches", type=int, default=0)
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()
    if args.batch_size < 1:
        raise SystemExit("batch-size must be positive")
    source_path = args.source if args.source.is_absolute() else ROOT / args.source
    output_path = args.output if args.output.is_absolute() else ROOT / args.output
    progress_path = args.progress if args.progress.is_absolute() else ROOT / args.progress
    baseline = read_assignment(source_path, "WORD_AI_EXAMPLE_LIBRARY")
    library = read_assignment(ROOT / "public" / "word-senses.js", "WORD_SENSE_LIBRARY").get("entries", {})
    progress = load_progress(progress_path, args.restart)
    for word, mapping in MANUAL_CONTEXT_OVERRIDES.items():
        progress["mappings"][word] = mapping
        progress["failures"].pop(word, None)
    save_progress(progress_path, progress)
    requests: dict[str, dict] = {}
    direct: dict[str, dict[str, str]] = {}
    invalid: dict[str, str] = {}
    for word, record in baseline.get("entries", {}).items():
        normalized = str(word).lower()
        request, automatic, reason = review_request(normalized, record, library)
        direct[normalized] = automatic
        if reason:
            invalid[normalized] = reason
        elif request is not None and normalized not in progress["mappings"]:
            requests[normalized] = request
    if invalid:
        print(json.dumps({"status": "blocked", "invalidSourceRecords": len(invalid), "examples": list(invalid.items())[:10]}, ensure_ascii=False))
        raise SystemExit(2)
    pending = list(requests.items())
    completed_batches = 0
    for start in range(0, len(pending), args.batch_size):
        if args.limit_batches and completed_batches >= args.limit_batches:
            break
        batch_pairs = pending[start:start + args.batch_size]
        response = call_reviewer([request for _, request in batch_pairs], start // args.batch_size + 1, args.model)
        accepted, failures = validate_response(dict(batch_pairs), response)
        progress["mappings"].update(accepted)
        progress["failures"].update(failures)
        save_progress(progress_path, progress)
        completed_batches += 1
        print(json.dumps({"batch": completed_batches, "reviewedWords": len(accepted), "failedWords": len(failures), "completedMappings": len(progress["mappings"]), "remainingWords": max(0, len(pending) - start - len(batch_pairs))}, ensure_ascii=False), flush=True)
        if failures:
            raise SystemExit(3)
    still_pending = set(requests) - set(progress["mappings"])
    if still_pending:
        print(json.dumps({"status": "incomplete", "remainingWords": len(still_pending), "failedWords": progress["failures"]}, ensure_ascii=False))
        return
    resolved: dict[str, dict] = {}
    unresolved: dict[str, str] = {}
    for word, record in baseline.get("entries", {}).items():
        normalized = str(word).lower()
        mapping = dict(direct.get(normalized, {}))
        mapping.update(progress["mappings"].get(normalized, {}))
        result = atomize(normalized, record, mapping, library)
        if result is None:
            unresolved[normalized] = "missing or invalid final mapping"
        else:
            resolved[normalized] = result
    if unresolved:
        print(json.dumps({"status": "blocked", "unresolvedRecords": len(unresolved), "examples": list(unresolved.items())[:10]}, ensure_ascii=False))
        raise SystemExit(4)
    payload = {"source": "bilingual context review with one exact dictionary sense per example", "generatedAt": baseline.get("generatedAt"), "contextSenseReview": "20260928-01", "entries": resolved}
    write_assignment(output_path, payload)
    print(json.dumps({"status": "complete", "records": len(resolved), "examples": sum(len(record["examples"]) for record in resolved.values()), "atomicGroups": sum(len(record["senseGroups"]) for record in resolved.values()), "output": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
