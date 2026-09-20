"""Build a small, offline, attributed English-Chinese example library for 27-One.

The raw Tatoeba export is intentionally kept out of the published site.  This
script retains only direct English--Mandarin sentence pairs that pass clear,
conservative checks; it also writes a coverage report for human review.
"""

from __future__ import annotations

import bz2
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "tatoeba"
BOOK = ROOT / "public" / "bundled-imports" / "27-one.json"
OUTPUT = ROOT / "public" / "example-library.js"
REPORT = ROOT / "data" / "tatoeba" / "coverage-report.json"
MAX_EXAMPLES_PER_WORD = 6

WORD_TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
ASCII_SENTENCE = re.compile(r'^[A-Z“\"]')
SENTENCE_END = re.compile(r'\.$')
CHINESE = re.compile(r"[\u3400-\u9fff]")
BAD_ENGLISH = re.compile(r"(?:\.{2,}|\b(?:http|www)\b|[\[\]{}<>\"“”]|\s{2,})", re.I)
BAD_CHINESE = re.compile(r"(?:\.{3,}|\b(?:http|www)\b|[\[\]{}<>]|\s{2,})", re.I)


def combine_english_parts() -> Path:
    """Join the fixed HTTP range downloads into the original .bz2 file."""
    parts = [RAW / f"eng.part{index}" for index in range(8)]
    missing = [str(part) for part in parts if not part.exists() or not part.stat().st_size]
    if missing:
        raise SystemExit(f"Missing English download parts: {', '.join(missing)}")
    destination = RAW / "eng_sentences.tsv.bz2"
    with destination.open("wb") as target:
        for part in parts:
            with part.open("rb") as source:
                shutil.copyfileobj(source, target)
    return destination


def read_tsv_bz2(path: Path):
    with bz2.open(path, "rt", encoding="utf-8") as source:
        for raw_line in source:
            fields = raw_line.rstrip("\n").split("\t", 2)
            if len(fields) == 3:
                yield fields


def normalize_english(value: str) -> str:
    return " ".join(value.lower().split())


def is_good_pair(english: str, chinese: str) -> bool:
    english = english.strip()
    chinese = chinese.strip()
    words = WORD_TOKEN.findall(english)
    if not (5 <= len(words) <= 26 and 18 <= len(english) <= 180):
        return False
    if not (2 <= len(chinese) <= 100 and CHINESE.search(chinese)):
        return False
    if not ASCII_SENTENCE.match(english) or not SENTENCE_END.search(english):
        return False
    if any(marker in english for marker in ('"', '“', '”', '?', '!')):
        return False
    if BAD_ENGLISH.search(english) or BAD_CHINESE.search(chinese):
        return False
    return True


def blank_target(sentence: str, target: str) -> str:
    pattern = re.compile(rf"(?<![A-Za-z])({re.escape(target)})(?![A-Za-z])", re.I)
    return pattern.sub("____", sentence, count=1)


def main() -> None:
    english_file = combine_english_parts()
    book = json.loads(BOOK.read_text(encoding="utf-8"))
    targets = {str(word).lower() for word in book["words"] if str(word).strip()}

    # Direct English -> Mandarin Chinese links only.  This avoids machine-pivoted
    # translations and keeps the relation between the two displayed sentences.
    chinese_ids_by_english: dict[str, list[str]] = defaultdict(list)
    links_file = RAW / "eng-cmn_links.tsv.bz2"
    with bz2.open(links_file, "rt", encoding="utf-8") as source:
        for raw_line in source:
            fields = raw_line.rstrip("\n").split("\t")
            if len(fields) == 2:
                chinese_ids_by_english[fields[0]].append(fields[1])

    linked_chinese_ids = {item for values in chinese_ids_by_english.values() for item in values}
    chinese_by_id: dict[str, str] = {}
    for sentence_id, language, text in read_tsv_bz2(RAW / "cmn_sentences.tsv.bz2"):
        if sentence_id in linked_chinese_ids and language == "cmn":
            chinese_by_id[sentence_id] = text.strip()

    candidates: dict[str, list[dict[str, str | int]]] = defaultdict(list)
    seen_by_word: dict[str, set[str]] = defaultdict(set)
    parsed_linked_english = 0
    for sentence_id, language, english in read_tsv_bz2(english_file):
        if language != "eng" or sentence_id not in chinese_ids_by_english:
            continue
        parsed_linked_english += 1
        english = english.strip()
        tokens = {token.lower() for token in WORD_TOKEN.findall(english)}
        matched_words = targets.intersection(tokens)
        if not matched_words:
            continue
        for chinese_id in chinese_ids_by_english[sentence_id]:
            chinese = chinese_by_id.get(chinese_id, "")
            if not is_good_pair(english, chinese):
                continue
            normalized = normalize_english(english)
            for word in matched_words:
                if normalized in seen_by_word[word]:
                    continue
                seen_by_word[word].add(normalized)
                candidates[word].append({
                    "sentence": english,
                    "translation": chinese,
                    "sourceSentenceId": int(sentence_id),
                    "sourceTranslationId": int(chinese_id),
                })

    # Prefer medium-length statements. They are easy to listen to, fit a phone
    # screen, and leave the remaining candidates as genuine review variations.
    def rank(item: dict[str, str | int]) -> tuple[int, int, str]:
        sentence = str(item["sentence"])
        has_named_character = int(bool(re.search(r"\b(?:Tom|Mary|John|Alice)\b", sentence)))
        return (has_named_character, abs(len(WORD_TOKEN.findall(sentence)) - 12), sentence.lower())

    library: dict[str, dict[str, object]] = {}
    coverage = {"0": 0, "1": 0, "2": 0, "3+": 0}
    for word in sorted(targets):
        selected = sorted(candidates[word], key=rank)[:MAX_EXAMPLES_PER_WORD]
        count = len(selected)
        if count == 0:
            coverage["0"] += 1
            continue
        if count == 1:
            coverage["1"] += 1
        elif count == 2:
            coverage["2"] += 1
        else:
            coverage["3+"] += 1
        primary = selected[0]
        review = []
        for item in selected[1:]:
            blanked = blank_target(str(item["sentence"]), word)
            if "____" in blanked:
                review.append([item["translation"], blanked, item["sourceSentenceId"], item["sourceTranslationId"]])
        library[word] = {
            "sentence": primary["sentence"],
            "translation": primary["translation"],
            "sourceSentenceId": primary["sourceSentenceId"],
            "sourceTranslationId": primary["sourceTranslationId"],
            "review": review,
        }

    attribution = (
        "Tatoeba sentence pairs, CC BY 2.0 FR. "
        "Each retained record includes its English and Mandarin Chinese source IDs."
    )
    payload = {"source": "Tatoeba", "license": "CC BY 2.0 FR", "attribution": attribution, "entries": library}
    OUTPUT.write_text("window.WORD_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    report = {
        "targetWords": len(targets),
        "directEnglishChinesePairs": len(chinese_ids_by_english),
        "parsedLinkedEnglish": parsed_linked_english,
        "publishedWords": len(library),
        "publishedExamples": sum(1 + len(item["review"]) for item in library.values()),
        "coverage": coverage,
        "maxExamplesPerWord": MAX_EXAMPLES_PER_WORD,
        "qualityRules": [
            "direct English-Mandarin pair",
            "target word exact surface form",
            "complete declarative English sentence ending in a period",
            "5-26 English words",
            "Chinese translation with Chinese characters",
            "no dialogue quotes, questions, exclamations, or duplicate English sentence per target",
        ],
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
