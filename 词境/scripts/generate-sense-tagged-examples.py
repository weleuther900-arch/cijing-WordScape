"""Generate five offline examples per word with explicit dictionary-sense links.

This is intentionally leaner than the first experimental generator: a Pro
writer and a separate Pro sense editor review every set, while only failed sets
make a third repair request. The resulting data is sufficient for the app to
alternate senses after a correct answer and vary examples after an error.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOK_PATH = ROOT / "public" / "bundled-imports" / "27-one.json"
SENSE_LIBRARY_PATH = ROOT / "public" / "word-senses.js"
DEFAULT_OUTPUT_PATH = ROOT / "public" / "ai-example-library.js"
DEFAULT_PROGRESS_PATH = ROOT / "data" / "sense-example-progress.json"
API_URL = "https://api.deepseek.com/chat/completions"
MODEL_DEFAULT = "deepseek-v4-pro"
WORD_TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CHINESE = re.compile(r"[\u3400-\u9fff]")
STRUCTURE_SIGNAL = re.compile(r"\b(?:although|because|while|when|if|unless|without|despite|through|during|whereas|thereby|therefore|rather\s+than|not\s+only|which|that|who|whose|where|how|before|after|in\s+order\s+to|so\s+that|to\s+ensure)\b", re.I)
IRREGULAR_TARGET_FORMS = {
    "be": {"am", "is", "are", "was", "were", "been", "being"}, "do": {"does", "did", "done", "doing"},
    "go": {"goes", "went", "gone", "going"}, "have": {"has", "had", "having"}, "make": {"makes", "made", "making"},
    "write": {"writes", "wrote", "written", "writing"}, "take": {"takes", "took", "taken", "taking"},
    "draw": {"draws", "drew", "drawn", "drawing"}, "run": {"runs", "ran", "running"}, "come": {"comes", "came", "coming"},
    "see": {"sees", "saw", "seen", "seeing"}, "speak": {"speaks", "spoke", "spoken", "speaking"},
    "teach": {"teaches", "taught", "teaching"}, "think": {"thinks", "thought", "thinking"}, "buy": {"buys", "bought", "buying"},
    "choose": {"chooses", "chose", "chosen", "choosing"}, "rise": {"rises", "rose", "risen", "rising"}, "arise": {"arises", "arose", "arisen", "arising"},
    "child": {"children"}, "person": {"people"}, "man": {"men"}, "woman": {"women"}, "mouse": {"mice"}, "ox": {"oxen"}, "thief": {"thieves"}, "pay": {"paid"}, "ride": {"rides", "rode", "ridden", "riding"}, "forget": {"forgets", "forgot", "forgotten", "forgetting"}, "say": {"says", "said", "saying"}, "die": {"dies", "died", "dying"}, "bleed": {"bleeds", "bled", "bleeding"}, "string": {"strung"}, "become": {"became"}, "squirrel": {"squirrelled", "squirrelling"}, "spiral": {"spiralled", "spiralling"},
}


def load_local_env() -> None:
    path = ROOT / ".env.local"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))


def read_js_payload(path: Path, variable: str) -> dict:
    text = path.read_text(encoding="utf-8")
    marker = f"window.{variable} ="
    if marker not in text:
        raise ValueError(f"{path.name} does not define {variable}")
    return json.loads(text.split(marker, 1)[1].strip().rstrip(";"))


def normal_text(value: str) -> str:
    return " ".join(str(value or "").lower().split())


def exact_word_pattern(word: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z]){re.escape(word)}(?![A-Za-z])", re.I)


def valid_target_form(word: str, target_form: str) -> bool:
    """Accept a human-reviewed grammatical surface form appearing in the example.

    A sentence may naturally require an irregular past form, plural, participle,
    or another legitimate surface form.  The reviewer, sense mapping, and exact
    in-sentence check establish that it belongs to the requested entry; this
    helper must not force prose back to a lemma merely because a finite form
    list does not know an irregular spelling.
    """
    lemma = word.lower().strip()
    form = target_form.lower().strip()
    phrase_pattern = r"[a-z]+(?:-[a-z]+)*(?:'[a-z]+)?(?:\s+[a-z]+(?:-[a-z]+)*(?:'[a-z]+)?)+"
    if " " in lemma or " " in form:
        return bool(re.fullmatch(phrase_pattern, form))
    return bool(lemma and re.fullmatch(r"[a-z]+(?:-[a-z]+)*(?:'[a-z]+)?", form))


def selected_source_senses(senses: list[dict]) -> list[dict]:
    """Keep the supplied dictionary context broad enough for polysemous words.

    The former three-per-part-of-speech shortcut omitted central meanings such
    as ``draw`` = "画" merely because the dictionary listed "拉" first.  Five
    examples cannot cover every rare gloss, but the editor needs to see the
    whole normal sense range before it decides which groups are worth using.
    """
    return senses[:24]


def source_sense_map(requested: dict) -> dict[str, dict]:
    return {str(item["id"]): item for item in requested["sourceSenses"]}


def content_tokens(sentence: str, word: str) -> set[str]:
    stop = {"a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "to", "with", word.lower()}
    return {token.lower() for token in WORD_TOKEN.findall(sentence) if token.lower() not in stop}


def near_duplicate(sentence: str, word: str, accepted: list[dict]) -> bool:
    tokens = content_tokens(sentence, word)
    if not tokens:
        return True
    for item in accepted:
        other = content_tokens(item["sentence"], word)
        if len(tokens & other) / max(1, min(len(tokens), len(other))) >= 0.75:
            return True
    return False


def normalize_groups(requested: dict, raw_groups: object) -> tuple[dict[str, dict], list[str]]:
    allowed = source_sense_map(requested)
    groups: dict[str, dict] = {}
    errors: list[str] = []
    used_source_ids: set[str] = set()
    if not isinstance(raw_groups, list):
        return {}, ["senseGroups is not a list"]
    for raw in raw_groups:
        if not isinstance(raw, dict):
            errors.append("sense group is not an object")
            continue
        group_id = str(raw.get("id", "")).strip()
        source_ids = [str(value) for value in raw.get("sourceSenseIds", []) if str(value) in allowed]
        if not re.fullmatch(r"sense-[1-9][0-9]*", group_id):
            errors.append("invalid sense group id")
            continue
        if not source_ids or group_id in groups:
            errors.append("sense group has no valid source senses or repeats an id")
            continue
        if any(source_id in used_source_ids for source_id in source_ids):
            errors.append("a source sense appears in more than one group")
            continue
        parts = {allowed[source_id]["partOfSpeech"] for source_id in source_ids}
        if len(parts) != 1:
            errors.append("a sense group mixes parts of speech")
            continue
        used_source_ids.update(source_ids)
        groups[group_id] = {
            "id": group_id,
            "partOfSpeech": next(iter(parts)),
            "sourceSenseIds": source_ids,
            "sense": "；".join(allowed[source_id]["sense"] for source_id in source_ids),
        }
    return groups, errors


def locally_valid(word: str, example: object, group_ids: set[str]) -> tuple[bool, str]:
    if not isinstance(example, dict):
        return False, "example is not an object"
    sentence = str(example.get("sentence", "")).strip()
    translation = str(example.get("translation", "")).strip()
    target_form = str(example.get("targetForm", word)).strip()
    if str(example.get("senseId", "")) not in group_ids:
        return False, "example has no valid sense group"
    if not 18 <= len(sentence) <= 180 or not 9 <= len(WORD_TOKEN.findall(sentence)) <= 28:
        return False, "English length is outside the required range"
    if not re.match(r"^[A-Z]", sentence) or not sentence.endswith(".") or any(char in sentence for char in ('"', '“', '”', '?', '!')):
        return False, "English sentence is not a capitalized declarative sentence"
    if not valid_target_form(word, target_form):
        return False, "target form is not a valid learnable form of the supplied word"
    if not exact_word_pattern(target_form).search(sentence):
        return False, "target form is not present in the sentence"
    if not (2 <= len(translation) <= 120 and CHINESE.search(translation)) or any(char in translation for char in ('?', '？', '!', '！', '"', '“', '”')):
        return False, "translation is missing or malformed"
    return True, ""


def strictly_valid(word: str, example: object, group_ids: set[str]) -> tuple[bool, str]:
    """Release gate for newly written IELTS / graduate-exam examples only."""
    valid, reason = locally_valid(word, example, group_ids)
    if not valid:
        return valid, reason
    sentence = str(example.get("sentence", "")).strip()
    translation = str(example.get("translation", "")).strip()
    if not 10 <= len(WORD_TOKEN.findall(sentence)) <= 26:
        return False, "English length is outside the strict learning range"
    if sum(sentence.count(mark) for mark in ".!?") != 1:
        return False, "English must contain exactly one complete sentence"
    if not translation.endswith("。") or sum(translation.count(mark) for mark in "。！？") != 1:
        return False, "Chinese must be one complete natural sentence"
    if not 6 <= len(translation) <= 72:
        return False, "Chinese length is outside the strict learning range"
    # A directly studied headword such as "rape" may occur in a restrained
    # legal or support-services example.  Flag sensitive material only when
    # it is unrelated to the target word being learned.
    if word.lower() != "rape" and re.search(r"\b(?:masturbat|rape|incest|pornograph)\w*\b", sentence, re.IGNORECASE):
        return False, "example is unsuitable for the learning library"
    return True, ""


def select_valid(requested: dict, raw_item: object, strict: bool = False) -> tuple[dict | None, list[str]]:
    if not isinstance(raw_item, dict):
        return None, ["word result is not an object"]
    groups, errors = normalize_groups(requested, raw_item.get("senseGroups"))
    if not groups:
        return None, errors or ["no valid sense groups"]
    accepted: list[dict] = []
    for example in raw_item.get("examples", []):
        valid, reason = (strictly_valid if strict else locally_valid)(requested["word"], example, set(groups))
        if not valid:
            errors.append(reason)
            continue
        sentence = str(example["sentence"]).strip()
        if normal_text(sentence) in {normal_text(item["sentence"]) for item in accepted}:
            errors.append("sentence repeats another example")
            continue
        if near_duplicate(sentence, requested["word"], accepted):
            errors.append("sentence is too similar to another example")
            continue
        accepted.append({"sentence": sentence, "translation": str(example["translation"]).strip(), "targetForm": str(example.get("targetForm", requested["word"])).strip(), "senseId": str(example["senseId"])})
        if len(accepted) == requested["requestedCount"]:
            break
    if len(accepted) != requested["requestedCount"]:
        return None, errors
    # A set must remain useful for writing practice, but a genuinely natural
    # declarative sentence is not rejected merely for lacking a marker word.
    # Requiring variety across the five avoids five simplistic templates.
    if requested.get("requireStructure", True) and sum(bool(STRUCTURE_SIGNAL.search(item["sentence"])) for item in accepted) < 3:
        return None, errors + ["fewer than three examples use a substantive written structure"]
    active_groups = {item["senseId"] for item in accepted}
    return {"senseGroups": [groups[group_id] for group_id in groups if group_id in active_groups], "examples": accepted}, errors


def call_api(api_key: str, model: str, messages: list[dict], stage: str) -> dict:
    body = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.18 if stage in {"review", "repair"} else 0.42,
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "stream": False,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            print(json.dumps({"stage": stage, "attempt": attempt + 1, "status": "requesting"}), flush=True)
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.loads(response.read().decode("utf-8"))
            print(json.dumps({"stage": stage, "status": "completed", "usage": payload.get("usage", {})}, ensure_ascii=False), flush=True)
            return json.loads(payload["choices"][0]["message"]["content"])
        except (urllib.error.HTTPError, urllib.error.URLError, http.client.IncompleteRead, TimeoutError, KeyError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{stage} failed after retries: {last_error}")


SYSTEM_WRITER = """You write publication-quality bilingual vocabulary examples for Chinese graduate entrance-exam and IELTS learners. Every pair must be a self-contained, logically clear, natural English sentence plus one accurate Simplified-Chinese sentence. You must link each example to exactly one supplied dictionary sense group. Return JSON only; do not use Markdown."""
SYSTEM_REVIEWER = """You are an adversarial bilingual editor for graduate entrance-exam and IELTS material. Rewrite any pair whose exact sense, grammar, collocation, logic, register, or Chinese translation is not unquestionably natural and useful. A structurally valid but awkward, vague, off-sense, overly basic, or context-dependent example must be replaced. Return only complete repaired JSON; no explanation or Markdown."""


def writer_prompt(batch: list[dict]) -> str:
    return json.dumps({
        "task": "For every word, first cluster only semantically close source senses with the same part of speech, then write exactly five final English-Chinese examples linked to those groups.",
        "rules": [
            "Use only supplied sourceSenseIds. A group must contain one part of speech and may combine only near-synonymous meanings. Do not mix distinct meanings merely to reduce the number of groups.",
            "Return each example with exactly one senseId. Across five examples, cover different common groups when natural; do not force obscure, archaic, or narrowly specialist meanings, and never use a rare derived verb merely to vary the target form. It is better to give five idiomatic examples of a central meaning than to demonstrate an unusual dictionary entry.",
            "Every English sentence must name its tested surface form in targetForm, and that form must appear exactly in the sentence. Use whichever grammatical surface form makes the sentence most natural, including irregular past forms, plurals, participles, or other legitimate forms; never force a lemma where ordinary English requires another form. Each sentence must be 10-26 words, capitalized, declarative, contain exactly one sentence, and end with one period. No dialogue, quotations, questions, exclamations, invented statistics, names that require background knowledge, news fragments, or dictionary-style definitions.",
            "Use polished, idiomatic upper-intermediate to advanced writing useful for graduate entrance exams and IELTS. Each sentence must be self-contained, logically clear, and suitable for a learner to imitate in writing. Prefer realistic academic, professional, social, environmental, educational, or everyday contexts; avoid partisan politics, sensational topics, inflated rhetoric, and awkward attempts to force a rare sense.",
            "The Chinese translation must accurately express the selected sense and the whole English sentence in natural Simplified Chinese. Write exactly one complete Chinese sentence ending in 。; do not add context that is absent from the English sentence.",
        ],
        "returnShape": {"items": [{"word": "exact word", "senseGroups": [{"id": "sense-1", "sourceSenseIds": ["n-1"], "partOfSpeech": "n."}], "examples": [{"sentence": "English", "translation": "Simplified Chinese", "targetForm": "tested form appearing in English", "senseId": "sense-1"}]}]},
        "items": batch,
    }, ensure_ascii=False)


def review_prompt(batch: list[dict], draft: dict, repair: bool = False) -> str:
    return json.dumps({
        "task": "Return a complete replacement result for every requested word. Audit and repair the proposed sense groups and examples.",
        "rules": [
            "Keep only valid supplied sourceSenseIds. Groups may combine only close meanings under the same part of speech. Every example must point to exactly one valid group.",
            "Return exactly five distinct examples per word. Verify the target word's actual sense, grammar, collocation, idiomatic Chinese translation, logical relation, and usefulness for exam writing. The English and Chinese must each be complete, self-contained, one-sentence statements with no missing surrounding context.",
            "Each sentence must name a targetForm that actually appears in it. Across each set, retain natural variation in number, tense, aspect, or voice where the word allows it. Each English sentence must be 10-26 words, capitalized, declarative, and end with one period; each Chinese translation must be one natural sentence ending in 。. It must use a meaningful connector, modifier, condition, contrast, purpose, or other substantive written structure without becoming artificial.",
            "Do not retain a weak, basic, strained, repetitive, context-dependent, politically topical, semantically mismatched, or awkwardly translated pair merely because it is grammatical. Rewrite it fully.",
        ],
        "returnShape": {"items": [{"word": "exact word", "senseGroups": [{"id": "sense-1", "sourceSenseIds": ["n-1"], "partOfSpeech": "n."}], "examples": [{"sentence": "English", "translation": "Simplified Chinese", "targetForm": "tested form appearing in English", "senseId": "sense-1"}]}]},
        "requested": batch,
        "draft": draft,
        "repair": repair,
    }, ensure_ascii=False)


def write_outputs(output_path: Path, progress_path: Path, model: str, entries: dict, diagnostics: dict) -> None:
    payload = {
        "source": "DeepSeek Pro offline generation with dictionary-sense binding and independent sense review",
        "model": model,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    output_path.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    progress_path.write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="DeepSeek model override.")
    parser.add_argument("--batch-size", type=int, default=3)
    parser.add_argument("--limit-batches", type=int, default=0)
    parser.add_argument("--output-path", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--progress-path", default=str(DEFAULT_PROGRESS_PATH))
    parser.add_argument("--debug-path", default="", help="Optional path for raw model responses from test runs.")
    parser.add_argument("--words-path", default="", help="Optional JSON queue containing a `words` list to regenerate.")
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    args = parser.parse_args()
    if args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit("shard-index must be between 0 and shard-count - 1")
    load_local_env()
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing from .env.local")
    model = args.model.strip() or os.getenv("DEEPSEEK_MODEL", MODEL_DEFAULT).strip() or MODEL_DEFAULT
    output_path = Path(args.output_path).resolve()
    progress_path = Path(args.progress_path).resolve()
    debug_path = Path(args.debug_path).resolve() if args.debug_path else None
    queued_words = None
    if args.words_path:
        queue_payload = json.loads(Path(args.words_path).resolve().read_text(encoding="utf-8"))
        queued_words = {str(word).strip().lower() for word in queue_payload.get("words", [])}
    wordbook = json.loads(BOOK_PATH.read_text(encoding="utf-8"))
    sense_library = read_js_payload(SENSE_LIBRARY_PATH, "WORD_SENSE_LIBRARY").get("entries", {})
    prior = read_js_payload(output_path, "WORD_AI_EXAMPLE_LIBRARY") if output_path.exists() else {"entries": {}}
    entries = prior.get("entries", {})
    debug_batches: list[dict] = []

    targets = []
    for raw_word in wordbook["words"]:
        word = str(raw_word).lower()
        if queued_words is not None and word not in queued_words:
            continue
        existing = entries.get(word, {})
        if len(existing.get("examples", [])) == 5 and existing.get("senseGroups"):
            continue
        candidates = selected_source_senses(sense_library.get(word, {}).get("senses", []))
        if not candidates:
            continue
        # The prompt requires writing-quality syntax, but a marker-word count
        # is not a reliable grammar test: concise academic sentences can be
        # sophisticated without a subordinate-clause signal.  The reviewer and
        # the local sentence/form/sense validators remain mandatory.
        targets.append({"word": word, "sourceSenses": candidates, "requestedCount": 5, "requireStructure": False})
    all_targets = len(targets)
    targets = targets[args.shard_index::args.shard_count]
    diagnostics = {"model": model, "shardIndex": args.shard_index, "shardCount": args.shard_count, "allTargetWords": all_targets, "initialWords": len(targets), "processedBatches": 0, "generatedWords": len(entries), "generatedExamples": sum(len(item.get("examples", [])) for item in entries.values()), "unresolved": []}

    for offset in range(0, len(targets), args.batch_size):
        if args.limit_batches and diagnostics["processedBatches"] >= args.limit_batches:
            break
        batch = targets[offset:offset + args.batch_size]
        draft = call_api(api_key, model, [{"role": "system", "content": SYSTEM_WRITER}, {"role": "user", "content": writer_prompt(batch)}], "writer")
        reviewed = call_api(api_key, model, [{"role": "system", "content": SYSTEM_REVIEWER}, {"role": "user", "content": review_prompt(batch, draft)}], "review")
        reviewed_items = {str(item.get("word", "")).lower(): item for item in reviewed.get("items", []) if isinstance(item, dict)}
        repair_requests: list[dict] = []
        valid_results: dict[str, dict] = {}
        for requested in batch:
            result, errors = select_valid(requested, reviewed_items.get(requested["word"]), strict=True)
            if result:
                valid_results[requested["word"]] = result
            else:
                repair_requests.append({**requested, "validationErrors": errors[:8]})
        if repair_requests:
            repaired = call_api(api_key, model, [{"role": "system", "content": SYSTEM_REVIEWER}, {"role": "user", "content": review_prompt(repair_requests, reviewed, repair=True)}], "repair")
            repaired_items = {str(item.get("word", "")).lower(): item for item in repaired.get("items", []) if isinstance(item, dict)}
            for requested in repair_requests:
                result, errors = select_valid(requested, repaired_items.get(requested["word"]), strict=True)
                if result:
                    valid_results[requested["word"]] = result
                else:
                    diagnostics["unresolved"].append({"word": requested["word"], "errors": errors[:8]})
        if debug_path:
            debug_batches.append({
                "requested": batch,
                "writer": draft,
                "review": reviewed,
                "repairRequests": repair_requests,
                "repair": repaired if repair_requests else None,
            })
            debug_path.parent.mkdir(parents=True, exist_ok=True)
            debug_path.write_text(json.dumps(debug_batches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        entries.update(valid_results)
        diagnostics["processedBatches"] += 1
        diagnostics["generatedWords"] = len(entries)
        diagnostics["generatedExamples"] = sum(len(item.get("examples", [])) for item in entries.values())
        write_outputs(output_path, progress_path, model, entries, diagnostics)
        print(json.dumps({"batch": diagnostics["processedBatches"], "of": (len(targets) + args.batch_size - 1) // args.batch_size, "generatedWords": diagnostics["generatedWords"], "unresolved": len(diagnostics["unresolved"])}, ensure_ascii=False), flush=True)

    remaining = [target["word"] for target in targets if len(entries.get(target["word"], {}).get("examples", [])) != 5]
    diagnostics["remaining"] = remaining
    diagnostics["complete"] = not remaining and (not args.limit_batches or diagnostics["processedBatches"] * args.batch_size >= len(targets))
    write_outputs(output_path, progress_path, model, entries, diagnostics)
    print(json.dumps({"status": "complete" if diagnostics["complete"] else "partial", "generatedWords": len(entries), "remaining": len(remaining), "unresolved": len(diagnostics["unresolved"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
