"""One-time DeepSeek enrichment for offline WordScape examples.

The phone app never calls this script or holds an API key.  It produces a
static library after two model passes (writer, then reviewer) and local checks.
Run with --limit-batches 1 first to confirm credentials, then without a limit.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOK_PATH = ROOT / "public" / "bundled-imports" / "27-one.json"
DICTIONARY_PATH = ROOT / "data" / "offline-dictionary.json"
CORPUS_PATH = ROOT / "public" / "example-library.js"
OUTPUT_PATH = ROOT / "public" / "ai-example-library.js"
PROGRESS_PATH = ROOT / "data" / "ai-examples-progress.json"
MODEL_DEFAULT = "deepseek-v4-pro"
MODEL = MODEL_DEFAULT
THINKING_TYPE = "disabled"
API_URL = "https://api.deepseek.com/chat/completions"
BATCH_SIZE = 14
# Every word is brought to five distinct offline examples. Existing Tatoeba
# examples are retained; DeepSeek only fills the gap.
MIN_EXAMPLES_PER_WORD = 5

WORD_TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CHINESE = re.compile(r"[\u3400-\u9fff]")
PART_OF_SPEECH = re.compile(r"\b(?:n|v|vt|vi|adj|adv|prep|pron|conj|aux|art|num|int)\.", re.I)
STRUCTURE_SIGNAL = re.compile(r"\b(?:although|because|while|when|if|unless|without|despite|through|whereas|thereby|therefore|therefore|rather\s+than|not\s+only|by\s+doing|to\s+ensure|which|that)\b", re.I)


def load_local_env() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def read_js_payload(path: Path, variable: str) -> dict:
    text = path.read_text(encoding="utf-8")
    marker = f"window.{variable} ="
    if marker not in text:
        raise ValueError(f"{path.name} does not define {variable}")
    return json.loads(text.split(marker, 1)[1].strip().rstrip(";"))


def normalize(value: str) -> str:
    return " ".join(str(value).lower().split())


def content_tokens(sentence: str, word: str) -> set[str]:
    stop_words = {"a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "to", "with"}
    return {token.lower() for token in WORD_TOKEN.findall(sentence) if token.lower() not in stop_words | {word.lower()}}


def is_near_duplicate(sentence: str, word: str, other_token_sets: list[set[str]]) -> bool:
    current = content_tokens(sentence, word)
    if not current:
        return True
    for other in other_token_sets:
        overlap = len(current & other) / max(1, min(len(current), len(other)))
        if overlap >= 0.75:
            return True
    return False


def restore_blanked(sentence: str, word: str) -> str:
    if not sentence.startswith("____"):
        return sentence.replace("____", word, 1)
    return sentence.replace("____", word[:1].upper() + word[1:], 1)


def exact_word_pattern(word: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z]){re.escape(word)}(?![A-Za-z])", re.I)


def locally_valid(word: str, item: dict) -> tuple[bool, str]:
    sentence = str(item.get("sentence", "")).strip()
    translation = str(item.get("translation", "")).strip()
    if not (18 <= len(sentence) <= 180):
        return False, "English sentence length is outside 18-180 characters"
    if not (9 <= len(WORD_TOKEN.findall(sentence)) <= 28):
        return False, "English sentence needs 9-28 words"
    if not re.match(r"^[A-Z]", sentence) or not sentence.endswith("."):
        return False, "English sentence must be a capitalized declarative sentence ending in a period"
    if any(mark in sentence for mark in ('"', '“', '”', '?', '!')):
        return False, "English sentence contains dialogue punctuation, a question, or an exclamation"
    if not exact_word_pattern(word).search(sentence):
        return False, "target word does not occur in its exact supplied form"
    # The final library is intended for writing practice, not isolated beginner
    # drills. A sentence needs an identifiable written structure as well as
    # correct grammar. The final editor can use a relative clause, a connector,
    # a contrast, a condition, or another formal pattern listed here.
    if not STRUCTURE_SIGNAL.search(sentence):
        return False, "sentence lacks a detectable transferable written structure"
    if not (2 <= len(translation) <= 100 and CHINESE.search(translation)):
        return False, "Chinese translation is missing or malformed"
    if any(mark in translation for mark in ('?', '？', '!', '！', '"', '“', '”')):
        return False, "Chinese translation contains dialogue/question/exclamation punctuation"
    return True, ""


def load_existing_records(corpus: dict, generated: dict) -> dict[str, list[dict]]:
    records: dict[str, list[dict]] = {}
    for word, item in corpus.get("entries", {}).items():
        examples = []
        if item.get("sentence") and item.get("translation"):
            examples.append({"sentence": item["sentence"], "translation": item["translation"]})
        for review in item.get("review", []):
            if len(review) >= 2:
                examples.append({"sentence": restore_blanked(str(review[1]), word), "translation": review[0]})
        records[word] = examples
    for word, item in generated.get("entries", {}).items():
        records.setdefault(word, []).extend(item.get("examples", []))
    return records


def compact_definition(raw: str) -> tuple[str, str]:
    raw = re.sub(r"\s+", " ", str(raw or "")).strip()
    pos = " / ".join(dict.fromkeys(PART_OF_SPEECH.findall(raw))) or "未标注"
    return pos, raw[:260]


def call_deepseek(api_key: str, messages: list[dict], stage: str) -> dict:
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "temperature": 0.12 if stage in {"review", "final", "repair"} else 0.42,
        "response_format": {"type": "json_object"},
        # Three independent editorial passes plus hard local validation are more
        # useful here than hidden chain-of-thought. Disabling it keeps the
        # 27,435-pair offline build predictable in both time and API usage.
        "thinking": {"type": THINKING_TYPE},
        "stream": False,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            print(json.dumps({"stage": stage, "attempt": attempt + 1, "status": "requesting"}), flush=True)
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.loads(response.read().decode("utf-8"))
            content = payload["choices"][0]["message"]["content"]
            usage = payload.get("usage", {})
            if usage:
                print(json.dumps({"stage": stage, "status": "completed", "usage": usage}, ensure_ascii=False), flush=True)
            return json.loads(content)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 4:
                break
            time.sleep(2 ** attempt)
    raise RuntimeError(f"DeepSeek {stage} request failed after retries: {last_error}")


SYSTEM_WRITER = """You are a meticulous bilingual editor for a Chinese graduate-English vocabulary app. The examples should be polished, idiomatic, and reusable in Chinese graduate entrance-exam writing, while remaining natural rather than ornate. Return JSON only. Do not use Markdown."""
SYSTEM_REVIEWER = """You are the final quality reviewer for a Chinese graduate-English vocabulary app. Reject textbook-like fragments, awkward sophistication, and empty rhetoric. Keep only polished, idiomatic sentences that a learner could naturally adapt in formal writing. Return JSON only. Do not explain your work or use Markdown."""
SYSTEM_MEMORY_EDITOR = """You are the final examiner and learning-design editor for a Chinese graduate-English vocabulary app. Each five-sentence set must be accurate, memorable, varied, and genuinely reusable for graduate entrance-exam and IELTS writing. Replace any weak line yourself. Return JSON only. Do not explain your work or use Markdown."""


def writer_prompt(batch: list[dict]) -> str:
    return json.dumps({
        "task": "Write natural, accurate English-Chinese example pairs for each vocabulary item.",
        "requirements": [
            "Produce exactly requestedCount different examples for every word.",
            "Each English sentence must use the exact supplied word form as a standalone word; do not inflect it.",
            "Each sentence must be a natural declarative sentence, 9-28 words, begin with a capital letter, and end with a period.",
            "No dialogue, quotation marks, question marks, exclamation marks, invented facts, or metalinguistic definitions.",
            "Use a sense supported by the supplied dictionary definition. Vary contexts and senses where the definition permits.",
            "Audit supplied existingExamples as possible source material. Retain one only when it already meets every requirement; otherwise replace it. Return five final examples, not comments about the audit.",
            "Every sentence must be genuinely reusable for Chinese graduate entrance-exam or IELTS writing, not merely grammatically correct. Use polished, idiomatic, upper-intermediate to advanced written English with a meaningful claim or observation.",
            "Use adaptable formal contexts such as education, research, work, communities, public policy, technology, environment, or carefully framed personal decisions. Avoid trivial daily actions, childish scenes, and empty textbook statements.",
            "Give every sentence a learnable written structure: a clear logical connector, a subordinate or relative clause, a purposeful infinitive or participial phrase, a precise contrast, or an equally substantive formal construction. Do not write a plain elementary subject-verb-object statement.",
            "Across a word's five examples, vary both collocations and sentence patterns. At least three should express a useful logical relationship such as cause and effect, contrast, concession, purpose, condition, evidence, or consequence, but never force a pattern that makes the sentence unnatural.",
            "Use a figurative sense only when the supplied dictionary definition clearly supports that sense. Avoid strained metaphors and translations that sound literal or unnatural in Chinese.",
            "Avoid rare literary phrasing, inflated claims, business slogans, unsupported statistics, and strings of difficult words used only to sound advanced.",
            "Write accurate, fluent Simplified-Chinese translations. Do not merely replace the English word with a Chinese gloss.",
        ],
        "returnShape": {"items": [{"word": "exact input word", "examples": [{"sentence": "English", "translation": "简体中文"}]}]},
        "items": batch,
    }, ensure_ascii=False)


def reviewer_prompt(batch: list[dict], draft: dict) -> str:
    return json.dumps({
        "task": "Independently review and repair the drafted vocabulary examples. Return replacements, not commentary.",
        "requirements": [
            "For every requested word, return exactly requestedCount examples.",
            "The final five examples replace the old selection. They must be distinct from one another; retaining an old example is allowed only if it meets every requirement below.",
            "Check English grammar, collocation, and whether the exact target word is used naturally in a sense supported by the dictionary definition.",
            "Check that every Simplified-Chinese translation faithfully translates the entire English sentence.",
            "Replace any weak, ambiguous, ungrammatical, repetitive, dialogue-like, question, exclamation, quote, or mismatched pair with a better one.",
            "Keep the language polished and genuinely reusable in graduate entrance-exam and IELTS writing. Reject elementary everyday scenes, empty textbook claims, and short generic sentences even when grammar is correct. Prefer precise, adaptable academic or formal everyday contexts over rare literary phrasing, slogans, or empty rhetoric.",
            "Reject any sentence that lacks a substantive written structure, relies on a strained metaphor, or uses a target-word sense not supported by the supplied definition. Make its Chinese translation idiomatic rather than word-for-word.",
            "For multiple examples of one word, ensure distinct collocations and sentence patterns whenever the supplied definition permits.",
            "Each English sentence: 9-28 words, capitalized, one declarative sentence ending in a period, exact target word form, no quote/question/exclamation punctuation.",
        ],
        "returnShape": {"items": [{"word": "exact input word", "examples": [{"sentence": "English", "translation": "简体中文"}]}]},
        "requested": batch,
        "draft": draft,
    }, ensure_ascii=False)


def memory_editor_prompt(batch: list[dict], reviewed: dict) -> str:
    return json.dumps({
        "task": "Perform the last quality gate on these bilingual vocabulary examples. Return five final replacements for each word, not an evaluation report.",
        "requirements": [
            "For every requested word, return exactly requestedCount distinct final examples using the exact supplied word form.",
            "Verify English grammar, natural collocation, word sense, and a faithful idiomatic Simplified-Chinese translation for every pair.",
            "Every final English sentence must be 9-28 words, begin with a capital letter, end with a period, and contain no dialogue, quotation marks, question marks, or exclamation marks.",
            "Every sentence must contain a learnable formal structure: a logical connector, subordinate or relative clause, purposeful infinitive or participial phrase, precise contrast, condition, consequence, or similarly substantive construction.",
            "The five examples must form a useful memory set: vary contexts, collocations, and sentence patterns; use multiple senses only when the supplied definition supports them; do not repeat one scenario in different words.",
            "Use natural upper-intermediate to advanced language transferable to Chinese graduate entrance-exam and IELTS writing. Reject basic daily scenes, strained metaphors, slogans, unsupported facts, and artificial difficulty.",
        ],
        "returnShape": {"items": [{"word": "exact input word", "examples": [{"sentence": "English", "translation": "Simplified Chinese"}]}]},
        "requested": batch,
        "reviewed": reviewed,
    }, ensure_ascii=False)


def repair_prompt(failed: list[dict], finalized: dict) -> str:
    return json.dumps({
        "task": "Repair only the failed final example sets below. Return a completely new five-example set for each listed word, not commentary.",
        "requirements": [
            "Use the exact supplied word form and return exactly requestedCount different examples for every word.",
            "Each English sentence must be 9-28 words, capitalized, declarative, and end with a period. No quotation marks, questions, or exclamations.",
            "Every sentence must have a detectable transferable formal structure such as although, because, while, when, if, unless, without, despite, through, whereas, thereby, rather than, not only, a relative clause with which or that, or a purposeful to ensure phrase.",
            "Keep grammar, collocation, word sense, and idiomatic Simplified-Chinese translation accurate. Use five distinct writing-friendly contexts and do not repeat a scenario.",
            "The previous set failed the listed program checks. Do not repeat those defects; replace the entire set rather than repairing only one line.",
        ],
        "returnShape": {"items": [{"word": "exact input word", "examples": [{"sentence": "English", "translation": "Simplified Chinese"}]}]},
        "failed": failed,
        "previousFinal": finalized,
    }, ensure_ascii=False)


def select_valid(word: str, candidates: list[dict], required: int, seen: set[str]) -> tuple[list[dict], list[str]]:
    accepted: list[dict] = []
    errors: list[str] = []
    accepted_tokens: list[set[str]] = []
    for item in candidates:
        if not isinstance(item, dict):
            errors.append("candidate is not an object")
            continue
        valid, reason = locally_valid(word, item)
        key = normalize(item.get("sentence", ""))
        if not valid:
            errors.append(reason)
        elif key in seen:
            errors.append("sentence repeats an existing example")
        elif is_near_duplicate(item["sentence"], word, accepted_tokens):
            errors.append("sentence is too similar to another example for this word")
        else:
            accepted.append({"sentence": item["sentence"].strip(), "translation": item["translation"].strip()})
            seen.add(key)
            accepted_tokens.append(content_tokens(item["sentence"], word))
        if len(accepted) == required:
            break
    return accepted, errors


def write_outputs(entries: dict, diagnostics: dict) -> None:
    payload = {
        "source": "DeepSeek one-time offline generation with a separate review pass",
        "model": MODEL,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    OUTPUT_PATH.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    PROGRESS_PATH.write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    global MODEL, THINKING_TYPE, OUTPUT_PATH, PROGRESS_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="DeepSeek model override, for example deepseek-v4-flash.")
    parser.add_argument("--thinking", choices=("enabled", "disabled"), default="disabled", help="Whether to enable DeepSeek thinking mode.")
    parser.add_argument("--limit-batches", type=int, default=0, help="Process only this many batches; 0 means all.")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Words per API batch. Smaller batches avoid long model responses.")
    parser.add_argument("--output-path", default=str(OUTPUT_PATH), help="Static library path. Use a separate path for test runs.")
    parser.add_argument("--progress-path", default=str(PROGRESS_PATH), help="Progress report path. Use a separate path for test runs.")
    parser.add_argument("--shard-index", type=int, default=0, help="Zero-based shard index for parallel offline generation.")
    parser.add_argument("--shard-count", type=int, default=1, help="Number of disjoint generation shards.")
    args = parser.parse_args()
    load_local_env()
    MODEL = args.model.strip() or os.getenv("DEEPSEEK_MODEL", MODEL_DEFAULT).strip() or MODEL_DEFAULT
    THINKING_TYPE = args.thinking
    OUTPUT_PATH = Path(args.output_path).resolve()
    PROGRESS_PATH = Path(args.progress_path).resolve()
    if args.shard_count < 1 or not (0 <= args.shard_index < args.shard_count):
        raise SystemExit("shard-index must be between 0 and shard-count - 1")
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY is missing from .env.local")

    book = json.loads(BOOK_PATH.read_text(encoding="utf-8"))
    dictionary = json.loads(DICTIONARY_PATH.read_text(encoding="utf-8")).get("entries", {})
    corpus = read_js_payload(CORPUS_PATH, "WORD_EXAMPLE_LIBRARY")
    prior = read_js_payload(OUTPUT_PATH, "WORD_AI_EXAMPLE_LIBRARY") if OUTPUT_PATH.exists() else {"entries": {}}
    generated = prior.get("entries", {})
    source_records = load_existing_records(corpus, {"entries": {}})

    targets = []
    for word in book["words"]:
        key = str(word).lower()
        # A generated entry is a complete, independently reviewed final set.
        # The public corpus is passed to the model as audit material, not trusted
        # automatically, so every displayed example meets the new writing standard.
        if len(generated.get(key, {}).get("examples", [])) >= MIN_EXAMPLES_PER_WORD:
            continue
        pos, definition = compact_definition((dictionary.get(key) or ["", ""])[1])
        targets.append({
            "word": key,
            "partOfSpeech": pos,
            "definition": definition,
            "requestedCount": MIN_EXAMPLES_PER_WORD,
            # Five is the maximum final display set, so there is no value in
            # sending an unbounded corpus list to the API.
            "existingExamples": source_records.get(key, [])[:MIN_EXAMPLES_PER_WORD],
        })

    all_targets_count = len(targets)
    targets = targets[args.shard_index::args.shard_count]

    diagnostics = {
        "model": MODEL,
        "minimumExamplesPerWord": MIN_EXAMPLES_PER_WORD,
        "auditsOriginalCorpus": True,
        "shardIndex": args.shard_index,
        "shardCount": args.shard_count,
        "allTargetWords": all_targets_count,
        "initialWordsNeedingExamples": len(targets),
        "processedBatches": 0,
        "generatedExamples": sum(len(value.get("examples", [])) for value in generated.values()),
        "unresolved": [],
    }
    if not targets:
        write_outputs(generated, diagnostics)
        print(json.dumps({"status": "complete", **diagnostics}, ensure_ascii=False))
        return

    for offset in range(0, len(targets), args.batch_size):
        if args.limit_batches and diagnostics["processedBatches"] >= args.limit_batches:
            break
        batch = targets[offset:offset + args.batch_size]
        draft = call_deepseek(api_key, [{"role": "system", "content": SYSTEM_WRITER}, {"role": "user", "content": writer_prompt(batch)}], "writer")
        reviewed = call_deepseek(api_key, [{"role": "system", "content": SYSTEM_REVIEWER}, {"role": "user", "content": reviewer_prompt(batch, draft)}], "review")
        finalized = call_deepseek(api_key, [{"role": "system", "content": SYSTEM_MEMORY_EDITOR}, {"role": "user", "content": memory_editor_prompt(batch, reviewed)}], "final")
        finalized_by_word = {str(item.get("word", "")).lower(): item.get("examples", []) for item in finalized.get("items", []) if isinstance(item, dict)}
        accepted_by_word: dict[str, list[dict]] = {}
        repair_needed: list[dict] = []
        for requested in batch:
            word = requested["word"]
            # Retained corpus sentences are allowed after the model audit, but
            # the five final examples still must be unique within this word.
            accepted, errors = select_valid(word, finalized_by_word.get(word, []), requested["requestedCount"], set())
            if len(accepted) != requested["requestedCount"]:
                repair_needed.append({**requested, "validationErrors": errors[:8]})
            else:
                accepted_by_word[word] = accepted

        if repair_needed:
            repaired = call_deepseek(api_key, [{"role": "system", "content": SYSTEM_MEMORY_EDITOR}, {"role": "user", "content": repair_prompt(repair_needed, finalized)}], "repair")
            repaired_by_word = {str(item.get("word", "")).lower(): item.get("examples", []) for item in repaired.get("items", []) if isinstance(item, dict)}
            for requested in repair_needed:
                word = requested["word"]
                accepted, errors = select_valid(word, repaired_by_word.get(word, []), requested["requestedCount"], set())
                if len(accepted) != requested["requestedCount"]:
                    diagnostics["unresolved"].append({"word": word, "needed": requested["requestedCount"], "accepted": len(accepted), "errors": errors[:8]})
                else:
                    accepted_by_word[word] = accepted

        for word, accepted in accepted_by_word.items():
            generated[word] = {"examples": accepted}
        diagnostics["processedBatches"] += 1
        diagnostics["generatedExamples"] = sum(len(value.get("examples", [])) for value in generated.values())
        write_outputs(generated, diagnostics)
        print(json.dumps({"batch": diagnostics["processedBatches"], "of": (len(targets) + args.batch_size - 1) // args.batch_size, "generatedExamples": diagnostics["generatedExamples"], "unresolved": len(diagnostics["unresolved"])}, ensure_ascii=False), flush=True)

    remaining = []
    for target in targets:
        key = target["word"]
        final_count = len(generated.get(key, {}).get("examples", []))
        if final_count < MIN_EXAMPLES_PER_WORD:
            remaining.append({"word": key, "count": final_count})
    diagnostics["remainingBelowMinimum"] = remaining
    diagnostics["complete"] = not remaining and (not args.limit_batches or diagnostics["processedBatches"] * args.batch_size >= len(targets))
    write_outputs(generated, diagnostics)
    print(json.dumps({"status": "complete" if diagnostics["complete"] else "partial", "generatedExamples": diagnostics["generatedExamples"], "remainingBelowMinimum": len(remaining), "unresolved": len(diagnostics["unresolved"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
