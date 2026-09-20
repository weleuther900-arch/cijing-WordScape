"""Fill strict-audit shortfalls without replacing retained bilingual pairs."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw-pre-audit-examples.js"
SENSES = ROOT / "public" / "word-senses.js"
REPORT = ROOT / "data" / "full-library-audit-report-20260822.json"
OUTPUT = ROOT / "data" / "self-authored-supplements-016.js"


def module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(result)
    return result


AUDIT = module("strict_audit", ROOT / "scripts" / "audit-and-curate-examples.py")
TOOLS = module("sense_tools", ROOT / "scripts" / "generate-sense-tagged-examples.py")


def assignment(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig").split("=", 1)[1].strip().rstrip(";"))


def write_supplement(path: Path, entries: dict[str, list[dict]]) -> None:
    path.write_text("window.SELF_AUTHORED_SUPPLEMENTS_016 = " + json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")


def norm(value: str) -> str:
    return " ".join(str(value).lower().split())


def shape(sentence: str, form: str) -> str:
    return re.sub(rf"(?<![a-z]){re.escape(str(form).lower())}(?![a-z])", "<target>", norm(sentence))


def selected_source(word: str, raw: dict, reviewed: dict, strict: dict, authored: dict, codex: dict, senses: list[dict]) -> dict:
    if word in authored:
        candidate = authored[word]
        return AUDIT.normalize_direct_record(raw, candidate, senses) if isinstance(candidate, list) else candidate
    if word in codex:
        return codex[word]
    if word in AUDIT.OVERRIDES:
        return AUDIT.OVERRIDES[word]
    if word in strict:
        return strict[word]
    return reviewed.get(word, raw)


def current(word: str, baseline: dict, all_senses: dict, reviewed: dict, strict: dict, authored: dict, codex: dict, supplements: dict) -> dict | None:
    raw = baseline["entries"][word]
    senses = all_senses.get(word, {}).get("senses", [])
    issues: dict[str, list[dict]] = {word: []}
    record = AUDIT.curatable_record(word, selected_source(word, raw, reviewed, strict, authored, codex, senses), issues, senses)
    if record and word in supplements:
        record = AUDIT.append_supplemental_examples(record, raw, supplements[word], senses)
        record = AUDIT.curatable_record(word, record, issues, senses)
    return record


def request_for(word: str, record: dict, senses: list[dict]) -> dict:
    groups = {str(group.get("id", "")): group for group in record["senseGroups"]}
    covered = {str(groups[item["senseId"]].get("partOfSpeech", "")).lower().rstrip(".") for item in record["examples"] if item["senseId"] in groups}
    required = {str(item.get("partOfSpeech", "")).lower().rstrip(".") for item in senses if str(item.get("partOfSpeech", "")).lower().rstrip(".") in {"n", "v", "adj", "adv", "pron", "conj", "prep"}}
    return {
        "word": word,
        "requestedCount": 5 - len(record["examples"]),
        "sourceSenses": senses[:24],
        "mustCoverParts": sorted(required - covered),
        "retainedExamples": [{key: item[key] for key in ("sentence", "translation", "targetForm")} for item in record["examples"]],
    }


def prompt(task: str, items: list[dict], draft: dict | None = None) -> str:
    body = {
        "task": task,
        "rules": [
            "Return JSON only. Return exactly requestedCount NEW examples per word, never a complete five-example rewrite.",
            "RetainedExamples are approved: do not alter, repeat, closely paraphrase, or translate them.",
            "Use only supplied sourceSenseIds; a sense group has one part of speech; cover every mustCoverParts item with a new example.",
            "Each English line is a concise, self-contained, idiomatic, logical declarative sentence suitable for graduate entrance-exam and IELTS writing. It has 10-26 words, starts with a capital, ends with one period, and contains its natural targetForm literally.",
            "Use natural cause, condition, purpose, contrast, evidence, or result where appropriate. Never use a reusable template, a dialogue, a quote, a question, an exclamation, invented statistics, or external context.",
            "Each Chinese line accurately and naturally translates the selected sense and whole sentence in concise Simplified Chinese. It is exactly one complete sentence ending in 。.",
            "Before returning, repair every grammar, collocation, word-sense, bilingual-logic, or Chinese-naturalness defect.",
        ],
        "returnShape": {"items": [{"word": "exact word", "senseGroups": [{"id": "sense-1", "sourceSenseIds": ["n-1"], "partOfSpeech": "n."}], "examples": [{"sentence": "English", "translation": "简体中文。", "targetForm": "form in English", "senseId": "sense-1"}]}]},
        "items": items,
    }
    if draft is not None:
        body["draftToAudit"] = draft
    return json.dumps(body, ensure_ascii=False)


def accept(request: dict, raw: object, known_shapes: set[str]) -> tuple[list[dict] | None, list[str]]:
    if not isinstance(raw, dict):
        return None, ["missing result"]
    groups, errors = TOOLS.normalize_groups(request, raw.get("senseGroups"))
    chosen: list[dict] = []
    retained = request["retainedExamples"]
    retained_sentences = {norm(item["sentence"]) for item in retained}
    used_shapes = set(known_shapes)
    for item in raw.get("examples", []):
        valid, reason = TOOLS.strictly_valid(request["word"], item, set(groups))
        if not valid:
            errors.append(reason)
            continue
        sentence, form = str(item["sentence"]).strip(), str(item.get("targetForm", "")).strip()
        pair_shape = shape(sentence, form)
        if norm(sentence) in retained_sentences:
            errors.append("repeats a retained sentence")
        elif TOOLS.near_duplicate(sentence, request["word"], retained + chosen):
            errors.append("is too similar to a retained or new sentence")
        elif pair_shape in used_shapes:
            errors.append("reuses a cross-word sentence skeleton")
        else:
            chosen.append({"sentence": sentence, "translation": str(item["translation"]).strip(), "targetForm": form, "senseId": str(item["senseId"])})
            used_shapes.add(pair_shape)
        if len(chosen) == request["requestedCount"]:
            break
    if len(chosen) != request["requestedCount"]:
        return None, errors
    present = {str(groups[item["senseId"]]["partOfSpeech"]).lower().rstrip(".") for item in chosen}
    missing = set(request["mustCoverParts"]) - present
    if missing:
        return None, errors + ["missing POS coverage: " + ",".join(sorted(missing))]
    return [{**item, "senseId": groups[item["senseId"]]["sourceSenseIds"][0]} for item in chosen], errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--limit-words", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--model", default="")
    args = parser.parse_args()
    if args.limit_words < 1 or args.batch_size < 1:
        raise SystemExit("limits must be positive")
    TOOLS.load_local_env()
    api_key = TOOLS.os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing from .env.local")
    model = args.model.strip() or TOOLS.os.getenv("DEEPSEEK_MODEL", TOOLS.MODEL_DEFAULT).strip() or TOOLS.MODEL_DEFAULT
    report, baseline, senses = json.loads(args.report.read_text(encoding="utf-8")), AUDIT.read_js(RAW), AUDIT.read_js(SENSES)["entries"]
    reviewed = AUDIT.read_js(AUDIT.REVIEWED)["entries"] if AUDIT.REVIEWED.exists() else {}
    strict = AUDIT.read_js(AUDIT.STRICT_REVIEWED)["entries"] if AUDIT.STRICT_REVIEWED.exists() else {}
    authored, codex = AUDIT.read_self_authored_entries(), AUDIT.read_codex_reviewed_entries()
    supplements = AUDIT.read_supplemental_entries()
    output_entries = assignment(args.output) if args.output.exists() else {}
    for word, examples in output_entries.items():
        supplements.setdefault(word, []).extend(examples)
    known_shapes = {shape(item.get("sentence", ""), item.get("targetForm", "")) for examples in supplements.values() for item in examples}
    requests: list[dict] = []
    for word in report["wordsHeldForReviewedRewrite"]:
        record = current(word, baseline, senses, reviewed, strict, authored, codex, supplements)
        if record and len(record["examples"]) < 5:
            requests.append(request_for(word, record, senses.get(word, {}).get("senses", [])))
        if len(requests) >= args.limit_words:
            break
    accepted_words = accepted_examples = 0
    unresolved: list[dict] = []
    for offset in range(0, len(requests), args.batch_size):
        batch = requests[offset:offset + args.batch_size]
        draft = TOOLS.call_api(api_key, model, [{"role": "system", "content": TOOLS.SYSTEM_WRITER}, {"role": "user", "content": prompt("Write only the missing supplement pairs.", batch)}], "writer")
        reviewed_output = TOOLS.call_api(api_key, model, [{"role": "system", "content": TOOLS.SYSTEM_REVIEWER}, {"role": "user", "content": prompt("Independently audit and replace weak draft pairs; return only missing supplements.", batch, draft)}], "review")
        produced = {str(item.get("word", "")).lower(): item for item in reviewed_output.get("items", []) if isinstance(item, dict)}
        repair: list[dict] = []
        additions: dict[str, list[dict]] = {}
        for request in batch:
            result, errors = accept(request, produced.get(request["word"]), known_shapes)
            if result is None:
                repair.append({**request, "validationErrors": errors[:8]})
            else:
                additions[request["word"]] = result
                known_shapes.update(shape(item["sentence"], item["targetForm"]) for item in result)
        if repair:
            repaired = TOOLS.call_api(api_key, model, [{"role": "system", "content": TOOLS.SYSTEM_REVIEWER}, {"role": "user", "content": prompt("Repair only failed supplement requests and return complete replacements.", repair, reviewed_output)}], "repair")
            repaired_items = {str(item.get("word", "")).lower(): item for item in repaired.get("items", []) if isinstance(item, dict)}
            for request in repair:
                result, errors = accept(request, repaired_items.get(request["word"]), known_shapes)
                if result is None:
                    unresolved.append({"word": request["word"], "errors": errors[:8]})
                else:
                    additions[request["word"]] = result
                    known_shapes.update(shape(item["sentence"], item["targetForm"]) for item in result)
        for word, examples in additions.items():
            output_entries.setdefault(word, []).extend(examples)
            accepted_words += 1
            accepted_examples += len(examples)
        write_supplement(args.output, output_entries)
        print(json.dumps({"processedWords": min(offset + len(batch), len(requests)), "requestedWords": len(requests), "acceptedWords": accepted_words, "acceptedExamples": accepted_examples, "unresolved": len(unresolved)}, ensure_ascii=False), flush=True)
    print(json.dumps({"status": "complete", "requestedWords": len(requests), "acceptedWords": accepted_words, "acceptedExamples": accepted_examples, "unresolved": unresolved}, ensure_ascii=False))


if __name__ == "__main__":
    main()
