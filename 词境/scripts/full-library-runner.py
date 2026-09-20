"""Build a complete, non-template bilingual example library with Codex CLI.

The runner writes only project-local drafts and the isolated full-release
candidate.  It never deploys a partial library: build/deploy are reachable
only after every bundled word has exactly five validation-gated examples.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WORD_BOOK = ROOT / "public" / "bundled-imports" / "27-one.json"
SENSES = ROOT / "public" / "word-senses.js"
FULL = DATA / "self-authored-examples-full.js"
STATUS = DATA / "full-library-rewrite-status.json"
DRAFTS = DATA / "codex-cli-full-drafts"
CODEX = ROOT / "tools" / "codex-cli" / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "bin" / "codex.exe"
PYTHON = Path(sys.executable)
NPM = Path(r"E:\node\npm.cmd")
NPX = Path(r"E:\node\npx.cmd")
WORD_TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CHINESE = re.compile(r"[\u3400-\u9fff]")
UNSAFE = re.compile(r"\b(?:masturbat|rape|incest|pornograph)\w*\b", re.I)
LEGACY_TEMPLATE = re.compile(
    r"seemed peripheral at first|earlier discussions had overlooked|"
    r"provided a useful basis for a more balanced decision|"
    r"remained relevant throughout the inquiry|clear account of .+final recommendation",
    re.I,
)


def read_assignment(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def write_assignment(path: Path, payload: dict) -> None:
    path.write_text(
        "window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def read_words() -> list[str]:
    payload = json.loads(WORD_BOOK.read_text(encoding="utf-8"))
    return [str(word).lower() for word in payload.get("words", payload)]


def read_senses() -> dict[str, dict]:
    return read_assignment(SENSES).get("entries", {})


def skeleton(sentence: str, word: str) -> str:
    text = " ".join(sentence.lower().split())
    return re.sub(rf"(?<![a-z]){re.escape(word.lower())}(?![a-z])", "<target>", text)


def valid_pair(word: str, example: dict, group_ids: set[str]) -> str | None:
    sentence = str(example.get("sentence", "")).strip()
    translation = str(example.get("translation", "")).strip()
    if example.get("targetForm") != word:
        return "target form must be the exact supplied headword"
    if str(example.get("senseId", "")) not in group_ids:
        return "example references an unknown sense group"
    if not re.search(rf"(?<![A-Za-z]){re.escape(word)}(?![A-Za-z])", sentence, re.I):
        return "target word does not occur literally in its sentence"
    if not 10 <= len(WORD_TOKEN.findall(sentence)) <= 26:
        return "English length is outside 10-26 words"
    if not re.match(r"^[A-Z]", sentence) or not sentence.endswith(".") or sum(sentence.count(mark) for mark in ".!?") != 1:
        return "English is not one capitalized declarative sentence"
    if not CHINESE.search(translation) or not translation.endswith("。") or sum(translation.count(mark) for mark in "。！？") != 1:
        return "Chinese is not one complete natural sentence"
    if not 6 <= len(translation) <= 72:
        return "Chinese length is outside the permitted range"
    if UNSAFE.search(sentence) or UNSAFE.search(translation) or LEGACY_TEMPLATE.search(sentence):
        return "sentence is unsuitable or matches a rejected legacy template"
    return None


def adapt_entry(word: str, raw: dict, source_senses: list[dict]) -> tuple[dict | None, str | None]:
    source = {str(item["id"]): item for item in source_senses}
    groups: list[dict] = []
    examples: list[dict] = []
    used_ids: set[str] = set()
    for ordinal, raw_group in enumerate(raw.get("senseGroups", []), start=1):
        # The CLI sometimes abbreviates this field to ``senseIds`` even when
        # the prompt names ``sourceSenseIds``.  Both carry the same supplied
        # dictionary IDs; validate the values rather than rejecting a valid
        # bilingual candidate over this harmless output-label variation.
        source_ids = [str(value) for value in raw_group.get("sourceSenseIds", raw_group.get("senseIds", []))]
        if not source_ids or any(item not in source for item in source_ids):
            return None, "group has unknown source sense IDs"
        if any(item in used_ids for item in source_ids):
            return None, "source sense is repeated across groups"
        parts = {source[item]["partOfSpeech"] for item in source_ids}
        if len(parts) != 1:
            return None, "group mixes parts of speech"
        used_ids.update(source_ids)
        group_id = f"sense-{ordinal}"
        groups.append({
            "id": group_id,
            "partOfSpeech": next(iter(parts)),
            "sourceSenseIds": source_ids,
            "sense": "；".join(source[item]["sense"] for item in source_ids),
        })
        for example in raw_group.get("examples", []):
            examples.append({
                "sentence": example.get("sentence", ""),
                "translation": example.get("translation", ""),
                "targetForm": example.get("targetForm", ""),
                "senseId": group_id,
            })
    if len(examples) != 5 or not groups:
        return None, "entry must contain exactly five nested examples"
    group_ids = {item["id"] for item in groups}
    seen: set[str] = set()
    for example in examples:
        issue = valid_pair(word, example, group_ids)
        shape = skeleton(str(example.get("sentence", "")), word)
        if issue:
            return None, issue
        if shape in seen:
            return None, "examples reuse the same sentence skeleton"
        seen.add(shape)
    return {"senseGroups": groups, "examples": examples}, None


def prompt_for(batch: list[str], sense_library: dict[str, dict]) -> str:
    requested = []
    for word in batch:
        senses = sense_library[word]["senses"][:18]
        requested.append({"word": word, "senses": senses})
    return json.dumps({
        "task": "Write final bilingual vocabulary examples for every requested word. First silently draft and adversarially review every pair; then output only the corrected result.",
        "output": "Exactly one JavaScript assignment: window.WORD_AI_EXAMPLE_LIBRARY = {\\\"entries\\\":{...}};. Do not use Markdown or any commentary. Put examples inside their applicable senseGroups.",
        "nonTemplateRule": [
            "Every sentence must be independently conceived. Never reuse a fill-in-the-blank frame, sentence skeleton, Chinese translation frame, rhetorical sequence, or merely substitute a target word.",
            "Across each word's five entries, vary subject, setting, clause order, grammatical construction, logical relationship, and discourse purpose. Never copy, imitate, or quote textbook or source sentences.",
        ],
        "qualityRule": [
            "Use only supplied source-sense IDs. A group may contain only one part of speech; use common useful senses and omit rare or strained senses.",
            "Return exactly five examples per word. Each must be a self-contained, idiomatic, logically clear English-Chinese pair suitable for Chinese postgraduate-exam and IELTS learners.",
            "Every English sentence has 10-26 words, starts with a capital, is declarative, has one final period, and uses the exact supplied headword literally. Set targetForm to that exact headword for every example.",
            "Every Chinese translation is accurate idiomatic Simplified Chinese, one complete sentence ending in 。. No political topics, sensational content, dialogue, quotations, invented statistics, vague filler, or external references.",
            "Group IDs must be sense-1, sense-2, etc. Every nested example has sentence, translation, targetForm, and senseId.",
        ],
        "requested": requested,
    }, ensure_ascii=False)


def generate_batch(batch: list[str], senses: dict[str, dict], ordinal: int) -> tuple[dict | None, str]:
    DRAFTS.mkdir(parents=True, exist_ok=True)
    output = DRAFTS / f"batch-{ordinal:04d}.js"
    prompt_path = DRAFTS / f"batch-{ordinal:04d}.prompt.json"
    if output.exists():
        output.unlink()
    if not CODEX.exists():
        return None, "project-local Codex CLI binary is missing"
    command = [
        str(CODEX), "exec", "--ephemeral", "--ignore-user-config", "--disable", "plugins", "--disable", "remote_plugin",
        "--sandbox", "read-only", "-m", "gpt-5.6-sol", "-C", str(ROOT), "-o", str(output), "-",
    ]
    # Passing a Python text pipe can still be converted through the Windows
    # ANSI code page by a child-process boundary.  A UTF-8 file opened in
    # binary mode gives the CLI the exact bytes it requires.
    prompt_path.write_text(prompt_for(batch, senses), encoding="utf-8")
    try:
        with prompt_path.open("rb") as prompt_file:
            completed = subprocess.run(
                command,
                stdin=prompt_file,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=ROOT,
                capture_output=True,
                timeout=180,
            )
    except subprocess.TimeoutExpired:
        return None, "Codex CLI timed out"
    if completed.returncode != 0 or not output.exists():
        tail = (completed.stderr or completed.stdout or "no output").strip().replace("\n", " ")[-500:]
        return None, f"Codex CLI did not return a draft: {tail}"
    try:
        return read_assignment(output), ""
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return None, f"draft is not valid JSON assignment: {error}"


def write_status(status: dict) -> None:
    status["updatedAt"] = datetime.now(timezone.utc).isoformat()
    STATUS.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_full(words: list[str], entries: dict) -> list[str]:
    failures: list[str] = []
    if set(entries) != set(words):
        failures.append(f"expected {len(words)} words, found {len(entries)}")
    shapes: dict[str, str] = {}
    for word in words:
        entry = entries.get(word)
        if not entry:
            continue
        group_ids = {group["id"] for group in entry.get("senseGroups", [])}
        examples = entry.get("examples", [])
        if len(examples) != 5:
            failures.append(f"{word}: does not have five examples")
            continue
        for example in examples:
            issue = valid_pair(word, example, group_ids)
            if issue:
                failures.append(f"{word}: {issue}")
                continue
            shape = skeleton(example["sentence"], word)
            other = shapes.get(shape)
            if other and other != word:
                failures.append(f"{word}: repeats a sentence skeleton from {other}")
            else:
                shapes[shape] = word
    return failures


def deploy() -> None:
    curated = DATA / "strict-candidate-release.js"
    report = DATA / "strict-candidate-report.json"
    subprocess.run([str(PYTHON), "-B", "scripts/audit-and-curate-examples.py", "--input", "data/raw-pre-audit-examples.js", "--output", str(curated), "--report", str(report)], cwd=ROOT, check=True)
    release = read_assignment(curated).get("entries", {})
    words = read_words()
    failures = validate_full(words, release)
    if failures:
        raise RuntimeError("release candidate failed final validation: " + "; ".join(failures[:5]))
    subprocess.run([str(NPM), "run", "ios:web:prepare"], cwd=ROOT, check=True)
    subprocess.run([str(NPX), "--yes", "wrangler@latest", "deploy"], cwd=ROOT / "cloudflare", check=True)


def run() -> None:
    words = read_words()
    senses = read_senses()
    missing_senses = [word for word in words if word not in senses]
    if missing_senses:
        raise RuntimeError(f"missing sense records: {missing_senses[:5]}")
    DRAFTS.mkdir(parents=True, exist_ok=True)
    if FULL.exists():
        full = read_assignment(FULL)
    else:
        full = {"source": "Codex-authored, adversarially reviewed, and validation-gated bilingual examples", "entries": {}}
        write_assignment(FULL, full)
    status = json.loads(STATUS.read_text(encoding="utf-8")) if STATUS.exists() else {"startedAt": datetime.now(timezone.utc).isoformat(), "batchSize": 5, "retries": {}, "events": []}
    entries: dict = full.setdefault("entries", {})
    while True:
        pending = [word for word in words if word not in entries]
        status["acceptedWords"] = len(entries)
        status["pendingWords"] = len(pending)
        if not pending:
            failures = validate_full(words, entries)
            if failures:
                status["state"] = "final-validation-failed"
                status["failures"] = failures[:100]
                write_status(status)
                raise RuntimeError("final validation failed")
            status["state"] = "validated; deploying"
            write_status(status)
            deploy()
            status["state"] = "deployed"
            status["deployedAt"] = datetime.now(timezone.utc).isoformat()
            write_status(status)
            return
        batch = pending[:5]
        ordinal = int(status.get("attempts", 0)) + 1
        draft, error = generate_batch(batch, senses, ordinal)
        status["attempts"] = ordinal
        if not draft:
            key = ",".join(batch)
            status["retries"][key] = int(status["retries"].get(key, 0)) + 1
            status["lastError"] = error
            status["events"].append({"at": datetime.now(timezone.utc).isoformat(), "batch": batch, "error": error})
            status["events"] = status["events"][-100:]
            write_status(status)
            time.sleep(min(90, 5 * status["retries"][key]))
            continue
        converted: dict[str, dict] = {}
        problem = ""
        for word in batch:
            raw_entry = draft.get("entries", {}).get(word)
            if not isinstance(raw_entry, dict):
                problem = f"{word}: missing entry"
                break
            converted_entry, issue = adapt_entry(word, raw_entry, senses[word]["senses"])
            if issue:
                problem = f"{word}: {issue}"
                break
            converted[word] = converted_entry
        existing_shapes = {skeleton(example["sentence"], word) for word, entry in entries.items() for example in entry.get("examples", [])}
        if not problem:
            for word, entry in converted.items():
                for example in entry["examples"]:
                    shape = skeleton(example["sentence"], word)
                    if shape in existing_shapes:
                        problem = f"{word}: repeats an accepted cross-word sentence skeleton"
                        break
                    existing_shapes.add(shape)
                if problem:
                    break
        if problem:
            key = ",".join(batch)
            status["retries"][key] = int(status["retries"].get(key, 0)) + 1
            status["lastError"] = problem
            status["events"].append({"at": datetime.now(timezone.utc).isoformat(), "batch": batch, "error": problem})
            status["events"] = status["events"][-100:]
            write_status(status)
            time.sleep(min(90, 5 * status["retries"][key]))
            continue
        entries.update(converted)
        full["source"] = "Codex-authored, adversarially reviewed, and validation-gated bilingual examples"
        write_assignment(FULL, full)
        status["lastAcceptedBatch"] = batch
        status["lastError"] = ""
        status["events"].append({"at": datetime.now(timezone.utc).isoformat(), "batch": batch, "accepted": True})
        status["events"] = status["events"][-100:]
        write_status(status)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    if args.run:
        run()
