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
    r"^\s*((?:(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|det|num|int|interj)\.\s*(?:[/,;、]\s*)?)+)(.*)$",
    re.IGNORECASE,
)
POS_PART = re.compile(r"(?:n|v|vi|vt|adj|a|adv|ad|prep|pron|conj|aux|art|det|num|int|interj)\.", re.IGNORECASE)
POS_NORMALIZE = {"a.": "adj.", "ad.": "adv.", "vi.": "v.", "vt.": "v.", "interj.": "int."}

# A small, explicit correction layer for entries whose offline dictionary
# gloss is materially wrong or omits the ordinary learnable sense. Keep IDs
# stable and use this only after manual review; it prevents examples from
# being paired with a visibly incorrect definition in the iOS app.
SENSE_OVERRIDES: dict[str, list[dict[str, str]]] = {
    "a": [
        {"id": "other-2", "partOfSpeech": "art.", "sense": "一（个）"},
        {"id": "other-3", "partOfSpeech": "art.", "sense": "每一"},
    ],
    "according to": [
        {"id": "other-1", "partOfSpeech": "prep.", "sense": "根据"},
        {"id": "other-2", "partOfSpeech": "prep.", "sense": "按照"},
        {"id": "other-3", "partOfSpeech": "prep.", "sense": "取决于"},
        {"id": "other-4", "partOfSpeech": "prep.", "sense": "据……所说"},
    ],
    "agenda": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "议程"},
        {"id": "other-2", "partOfSpeech": "n.", "sense": "待办事项"},
    ],
    "air-conditioning": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "空调；空气调节"},
    ],
    "born": [{"id": "adj-1", "partOfSpeech": "v.", "sense": "出生；诞生"}, {"id": "adj-2", "partOfSpeech": "adj.", "sense": "天生的"}],
    "cafe": [{"id": "n-1", "partOfSpeech": "n.", "sense": "咖啡馆；咖啡店"}],
    "chalk": [{"id": "n-1", "partOfSpeech": "n.", "sense": "粉笔"}, {"id": "n-2", "partOfSpeech": "n.", "sense": "白垩"}, {"id": "v-1", "partOfSpeech": "v.", "sense": "用粉笔写（或画）"}],
    "concerning": [{"id": "prep-1", "partOfSpeech": "prep.", "sense": "关于；有关"}],
    "cyberspace": [{"id": "other-1", "partOfSpeech": "n.", "sense": "网络空间"}, {"id": "other-2", "partOfSpeech": "n.", "sense": "虚拟空间"}],
    "e-mail": [{"id": "other-1", "partOfSpeech": "n.", "sense": "电子邮件"}, {"id": "other-2", "partOfSpeech": "v.", "sense": "给……发电子邮件"}],
    "every": [{"id": "adj-1", "partOfSpeech": "det.", "sense": "每一"}, {"id": "adj-2", "partOfSpeech": "det.", "sense": "所有的"}],
    "host": [{"id": "n-1", "partOfSpeech": "n.", "sense": "主人；东道主"}, {"id": "n-3", "partOfSpeech": "n.", "sense": "节目主持人"}, {"id": "v-1", "partOfSpeech": "v.", "sense": "接待；招待"}, {"id": "v-2", "partOfSpeech": "v.", "sense": "主持（节目、活动）"}],
    "internet": [{"id": "other-1", "partOfSpeech": "n.", "sense": "互联网"}, {"id": "other-2", "partOfSpeech": "n.", "sense": "因特网"}],
    "its": [{"id": "pron-1", "partOfSpeech": "det.", "sense": "它的"}],
    "laptop": [{"id": "other-1", "partOfSpeech": "n.", "sense": "笔记本电脑；便携式电脑"}],
    "my": [{"id": "pron-1", "partOfSpeech": "det.", "sense": "我的"}],
    "no": [{"id": "n-1", "partOfSpeech": "n.", "sense": "否定回答"}, {"id": "n-2", "partOfSpeech": "n.", "sense": "拒绝"}, {"id": "n-3", "partOfSpeech": "n.", "sense": "反对票"}, {"id": "adj-1", "partOfSpeech": "det.", "sense": "没有"}, {"id": "adj-2", "partOfSpeech": "det.", "sense": "不是"}, {"id": "adj-3", "partOfSpeech": "det.", "sense": "绝非"}, {"id": "adv-1", "partOfSpeech": "adv.", "sense": "不；没有"}],
    "nothing": [{"id": "n-1", "partOfSpeech": "pron.", "sense": "没有什么"}, {"id": "n-2", "partOfSpeech": "pron.", "sense": "无关紧要的事"}, {"id": "n-3", "partOfSpeech": "pron.", "sense": "零"}, {"id": "adv-1", "partOfSpeech": "adv.", "sense": "毫不"}, {"id": "adv-2", "partOfSpeech": "adv.", "sense": "决不"}],
    "o'clock": [{"id": "n-1", "partOfSpeech": "adv.", "sense": "……点钟"}],
    "ounce": [{"id": "n-1", "partOfSpeech": "n.", "sense": "盎司"}, {"id": "n-2", "partOfSpeech": "n.", "sense": "少量"}, {"id": "n-3", "partOfSpeech": "n.", "sense": "雪豹"}],
    "our": [{"id": "pron-1", "partOfSpeech": "det.", "sense": "我们的"}],
    "plenty": [{"id": "n-1", "partOfSpeech": "pron.", "sense": "大量"}, {"id": "n-2", "partOfSpeech": "pron.", "sense": "充足"}, {"id": "n-3", "partOfSpeech": "pron.", "sense": "丰富"}, {"id": "adj-1", "partOfSpeech": "pron.", "sense": "大量"}, {"id": "adj-2", "partOfSpeech": "pron.", "sense": "充足"}, {"id": "adj-3", "partOfSpeech": "pron.", "sense": "丰富"}],
    "preside": [{"id": "v-3", "partOfSpeech": "v.", "sense": "主持"}, {"id": "v-5", "partOfSpeech": "v.", "sense": "负责"}, {"id": "v-6", "partOfSpeech": "v.", "sense": "指挥"}],
    "regardless": [{"id": "adj-1", "partOfSpeech": "adv.", "sense": "不管"}, {"id": "adj-2", "partOfSpeech": "adv.", "sense": "不加理会"}, {"id": "adj-3", "partOfSpeech": "adv.", "sense": "不顾"}],
    "such": [{"id": "adj-1", "partOfSpeech": "det.", "sense": "如此的"}, {"id": "adj-2", "partOfSpeech": "det.", "sense": "这样的"}],
    "their": [{"id": "pron-1", "partOfSpeech": "det.", "sense": "他们的；她们的；它们的"}],
    "whatsoever": [{"id": "pron-1", "partOfSpeech": "adv.", "sense": "任何；丝毫"}],
    "wherever": [{"id": "adv-1", "partOfSpeech": "conj.", "sense": "无论在哪里；在任何地方"}],
    "yes": [{"id": "adv-1", "partOfSpeech": "int.", "sense": "是；好的；同意"}, {"id": "n-1", "partOfSpeech": "n.", "sense": "肯定回答"}, {"id": "n-2", "partOfSpeech": "n.", "sense": "赞成；同意"}],
    "your": [{"id": "pron-1", "partOfSpeech": "det.", "sense": "你的"}, {"id": "pron-2", "partOfSpeech": "det.", "sense": "你们的"}],
    "zero": [{"id": "num-1", "partOfSpeech": "num.", "sense": "零"}, {"id": "n-1", "partOfSpeech": "n.", "sense": "零"}, {"id": "n-2", "partOfSpeech": "n.", "sense": "零点"}, {"id": "n-3", "partOfSpeech": "n.", "sense": "零度"}, {"id": "n-4", "partOfSpeech": "n.", "sense": "无"}, {"id": "n-5", "partOfSpeech": "n.", "sense": "乌有"}, {"id": "n-6", "partOfSpeech": "n.", "sense": "最低点"}, {"id": "adj-1", "partOfSpeech": "adj.", "sense": "零的"}, {"id": "adj-2", "partOfSpeech": "adj.", "sense": "没有的"}, {"id": "v-1", "partOfSpeech": "v.", "sense": "调零"}, {"id": "v-2", "partOfSpeech": "v.", "sense": "校正"}],
    "data": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "数据"},
        {"id": "other-2", "partOfSpeech": "n.", "sense": "资料"},
    ],
    "hello": [
        {"id": "other-1", "partOfSpeech": "int.", "sense": "你好"},
        {"id": "other-2", "partOfSpeech": "int.", "sense": "喂；嘿"},
    ],
    "hi": [
        {"id": "other-1", "partOfSpeech": "int.", "sense": "嗨；你好"},
    ],
    "scissors": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "剪刀"},
        {"id": "other-2", "partOfSpeech": "n.", "sense": "剪具"},
    ],
    "tram": [
        {"id": "n-1", "partOfSpeech": "n.", "sense": "电车"},
        {"id": "n-2", "partOfSpeech": "n.", "sense": "电车轨道"},
        {"id": "n-3", "partOfSpeech": "n.", "sense": "煤车"},
        {"id": "n-4", "partOfSpeech": "n.", "sense": "纬纱；纬丝"},
        {"id": "v-1", "partOfSpeech": "v.", "sense": "用煤车运载"},
        {"id": "v-2", "partOfSpeech": "v.", "sense": "乘电车"},
    ],
    "trousers": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "裤子"},
        {"id": "other-2", "partOfSpeech": "n.", "sense": "长裤"},
    ],
    "tv": [
        {"id": "other-1", "partOfSpeech": "n.", "sense": "电视；电视机"},
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
        elif re.match(r"^\[[^\]]+\]", line):
            # Domain labels in ECDICT are specialist metadata, not parts of speech.
            # The learning dictionary keeps ordinary senses and uses explicit overrides
            # when a headword is otherwise represented only by a domain line.
            continue
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
