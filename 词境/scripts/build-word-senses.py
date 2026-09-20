"""Build structured, stable dictionary senses for the bundled wordbook.

The app and the offline example generator both use these IDs.  A generated
sentence therefore has to identify one actual dictionary sense instead of
being loosely attached to a whole comma-separated definition string.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOK_PATH = ROOT / "public" / "bundled-imports" / "27-one.json"
DICTIONARY_PATH = ROOT / "data" / "offline-dictionary.json"
OUTPUT_PATH = ROOT / "public" / "word-senses.js"

POS_PREFIX = re.compile(
    r"^\s*((?:(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.\s*(?:[/,;、]\s*)?)+)(.*)$",
    re.IGNORECASE,
)
POS_PART = re.compile(r"(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|num|int)\.", re.IGNORECASE)
POS_NORMALIZE = {"a.": "adj.", "ad.": "adv.", "vi.": "v.", "vt.": "v."}

# A small, explicit correction layer for entries whose offline dictionary
# gloss is materially wrong or omits the ordinary learnable sense. Keep IDs
# stable and use this only after manual review; it prevents examples from
# being paired with a visibly incorrect definition in the iOS app.
SENSE_OVERRIDES: dict[str, list[dict[str, str]]] = {
    "tram": [
        {"id": "n-1", "partOfSpeech": "n.", "sense": "电车"},
        {"id": "n-2", "partOfSpeech": "n.", "sense": "电车轨道"},
        {"id": "n-3", "partOfSpeech": "n.", "sense": "煤车"},
        {"id": "n-4", "partOfSpeech": "n.", "sense": "纬纱；纬丝"},
        {"id": "v-1", "partOfSpeech": "v.", "sense": "用煤车运载"},
        {"id": "v-2", "partOfSpeech": "v.", "sense": "乘电车"},
    ],
}


def display_pos(prefix: str, fallback: str = "词性未标注") -> str:
    parts = []
    for value in POS_PART.findall(prefix):
        normalized = POS_NORMALIZE.get(value.lower(), value.lower())
        if normalized not in parts:
            parts.append(normalized)
    return " / ".join(parts) if parts else fallback


def clean_sense(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" ，,;；、")


def split_meanings(value: str) -> list[str]:
    # ECDICT normally separates Chinese glosses with commas. Keeping every
    # gloss as an addressable sense lets examples bind to one exact meaning.
    parts = [clean_sense(piece) for piece in re.split(r"\s*[,，;；、]\s*", value)]
    return [piece for piece in parts if piece and len(piece) <= 80]


def parse_definition(raw: str) -> list[dict]:
    active_pos = "词性未标注"
    counters: dict[str, int] = defaultdict(int)
    senses: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for line in str(raw or "").replace("\\n", "\n").splitlines():
        line = line.strip()
        if not line:
            continue
        match = POS_PREFIX.match(line)
        if match:
            active_pos = display_pos(match.group(1), active_pos)
            meaning_text = match.group(2)
        elif line.startswith("[计]"):
            active_pos = "计算机"
            meaning_text = line[3:]
        else:
            meaning_text = line

        for meaning in split_meanings(meaning_text):
            key = (active_pos, meaning)
            if key in seen:
                continue
            seen.add(key)
            counters[active_pos] += 1
            safe_pos = re.sub(r"[^a-z0-9]+", "-", active_pos.lower()).strip("-") or "other"
            senses.append({"id": f"{safe_pos}-{counters[active_pos]}", "partOfSpeech": active_pos, "sense": meaning})
    return senses


def main() -> None:
    words = [str(word).strip().lower() for word in json.loads(BOOK_PATH.read_text(encoding="utf-8"))["words"]]
    dictionary = json.loads(DICTIONARY_PATH.read_text(encoding="utf-8")).get("entries", {})
    entries: dict[str, dict] = {}
    missing: list[str] = []
    for word in words:
        record = dictionary.get(word)
        definition = record[1] if isinstance(record, list) and len(record) > 1 else ""
        senses = SENSE_OVERRIDES.get(word) or parse_definition(definition)
        if not senses:
            missing.append(word)
            continue
        entries[word] = {"senses": senses}

    payload = {
        "source": "offline-dictionary structured into stable part-of-speech and sense IDs",
        "entries": entries,
        "missing": missing,
    }
    OUTPUT_PATH.write_text("window.WORD_SENSE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"words": len(words), "entries": len(entries), "senses": sum(len(item["senses"]) for item in entries.values()), "missing": len(missing)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
