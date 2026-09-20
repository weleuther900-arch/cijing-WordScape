"""Audit every published example and build a conservative release library.

The old corpus builder guaranteed five syntactically valid examples, but its
last-resort templates and long parallel-corpus excerpts could still be poor
learning material.  This release gate is deliberately conservative: it keeps
only concise one-to-one bilingual pairs, removes every known template, detects
clear form/POS conflicts, and replaces the examples visible in the reported
screens with hand-reviewed sense-linked entries.  Entries without a reliable
pair are omitted rather than shown as a misleading sentence.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "corpus-backed-examples.js"
REVIEWED = ROOT / "data" / "quality-refreshed-examples.js"
STRICT_REVIEWED = ROOT / "data" / "strict-reviewed-examples.js"
SELF_AUTHORED = ROOT / "data" / "self-authored-examples.js"
CODEX_REVIEWED = ROOT / "data" / "codex-reviewed-examples.js"
REPORT = ROOT / "data" / "example-quality-audit-report.json"
WORD = re.compile(r"(?<![A-Za-z]){form}(?![A-Za-z])", re.IGNORECASE)
CHINESE = re.compile(r"[\u3400-\u9fff]")
TEMPLATE = re.compile(
    r"seemed peripheral at first|earlier discussions had overlooked|"
    r"provided a useful basis for a more balanced decision|"
    r"clear account of .+final recommendation|remained relevant throughout the inquiry|"
    r"result appeared .+committee requested further evidence|"
    r"panel considered the proposal .+concerns raised during consultation|"
    r"evidence became .+researchers explained its limitations|"
    r"approach is more persuasive when it is supported by transparent reasoning|"
    r"report remained .+central argument easier for readers|"
    r"evidence was incomplete, the committee considered how to|"
    r"new information emerged, the panel had to .+rather than rely on an earlier assumption|"
    r"researchers chose to .+only after they had checked|"
    r"clear criteria, it is difficult to .+other readers can evaluate fairly|"
    r"report explains why the team decided to .+reasoning more transparent|"
    r"committee responded .+evidence required a clear explanation for the public|"
    r"issue was complex, the report addressed it .+unsupported claims|"
    r"new findings appeared, the researchers adjusted their interpretation .+rather than hastily|"
    r"panel explained its decision .+readers follow the argument step by step|"
    r"reliable data, officials cannot act .+public confidence in the process|"
    r"report used .+connected the main argument with evidence|"
    r"topic was complex, the writer used .+relationship between two ideas clear|"
    r"readers encounter .+how it shapes the logic of the surrounding sentence|"
    r"editor retained .+argument more precise without making the style needlessly formal|"
    r"without .+transition between the two claims would have been less clear",
    re.IGNORECASE,
)
UNSAFE = re.compile(r"\b(?:masturbat|rape|incest|pornograph)\w*\b", re.IGNORECASE)
IRREGULAR_VERBS = {
    "am", "are", "is", "was", "were", "been", "did", "done", "went", "gone", "had", "made", "wrote", "written",
    "took", "taken", "ran", "came", "saw", "seen", "spoke", "spoken", "taught", "thought", "bought", "chose",
    "chosen", "rose", "risen", "paid", "rode", "ridden", "forgot", "forgotten", "drew", "drawn", "became", "become",
}


# These are the sentences shown in the report, manually checked for grammar,
# sense mapping, and natural Chinese.  They also provide a stable regression
# set for the exact failure modes that reached the learning page.
OVERRIDES = {
    "contact": {
        "senseGroups": [
            {"id": "sense-n", "partOfSpeech": "n.", "sourceSenseIds": ["n-1", "n-2", "n-3", "n-4"], "sense": "联系；接触"},
            {"id": "sense-v", "partOfSpeech": "v.", "sourceSenseIds": ["v-1", "v-2", "v-3"], "sense": "联系；接触"},
        ],
        "examples": [
            {"sentence": "We haven't contacted each other for quite a while, so I was glad to receive your letter.", "translation": "我们好久没有联系了，所以收到你的来信我很高兴。", "targetForm": "contacted", "senseId": "sense-v"},
            {"sentence": "Please contact the customer-service team if the device stops working.", "translation": "如果设备停止工作，请联系客户服务团队。", "targetForm": "contact", "senseId": "sense-v"},
            {"sentence": "The new student made contact with classmates through the debate club.", "translation": "这名新生通过辩论社与同学建立了联系。", "targetForm": "contact", "senseId": "sense-n"},
            {"sentence": "Keep my number in case you need to contact me later.", "translation": "请留着我的号码，以便你以后需要联系我。", "targetForm": "contact", "senseId": "sense-v"},
            {"sentence": "Direct contact with the author helped the translator clarify the final chapter.", "translation": "与作者直接联系帮助译者澄清了最后一章的疑问。", "targetForm": "contact", "senseId": "sense-n"},
        ],
    },
    "beef": {
        "senseGroups": [
            {"id": "sense-n-food", "partOfSpeech": "n.", "sourceSenseIds": ["n-1"], "sense": "牛肉"},
            {"id": "sense-n-strength", "partOfSpeech": "n.", "sourceSenseIds": ["n-2"], "sense": "力量；实质内容"},
            {"id": "sense-v-farm", "partOfSpeech": "v.", "sourceSenseIds": ["v-1", "v-2"], "sense": "养肉牛；宰牛"},
            {"id": "sense-v-complain", "partOfSpeech": "v.", "sourceSenseIds": ["v-3", "v-4"], "sense": "抱怨；告发"},
        ],
        "examples": [
            {"sentence": "The menu states where the beef was raised, so diners can consider animal welfare.", "translation": "菜单标明牛肉的养殖来源，让食客能据此考虑动物福利。", "targetForm": "beef", "senseId": "sense-n-food"},
            {"sentence": "The farmer raises beef cattle on land that is unsuitable for growing crops.", "translation": "这位农民在不适合种植庄稼的土地上饲养肉牛。", "targetForm": "beef", "senseId": "sense-v-farm"},
            {"sentence": "The report needs more beef before the board will approve the proposal.", "translation": "这份报告需要增加更多实质内容，董事会才会批准该提案。", "targetForm": "beef", "senseId": "sense-n-strength"},
            {"sentence": "Residents began to beef about the delayed repairs after weeks of waiting.", "translation": "等了数周后，居民开始抱怨维修一再拖延。", "targetForm": "beef", "senseId": "sense-v-complain"},
            {"sentence": "She ordered a bowl of beef noodles after the long train journey.", "translation": "漫长的火车旅程后，她点了一碗牛肉面。", "targetForm": "beef", "senseId": "sense-n-food"},
        ],
    },
    "active": {
        "senseGroups": [{"id": "sense-adj", "partOfSpeech": "adj.", "sourceSenseIds": ["adj-1", "adj-2", "adj-3", "adj-4", "adj-5", "adj-6", "adj-7", "adj-8"], "sense": "活跃的；积极的；有效的"}],
        "examples": [
            {"sentence": "The volcano remains active, so scientists monitor it around the clock.", "translation": "这座火山仍在活动，因此科学家昼夜监测它。", "targetForm": "active", "senseId": "sense-adj"},
            {"sentence": "She plays an active role in planning the community festival.", "translation": "她积极参与策划社区节日活动。", "targetForm": "active", "senseId": "sense-adj"},
            {"sentence": "Your membership is still active until the end of this month.", "translation": "你的会员资格在本月底前仍然有效。", "targetForm": "active", "senseId": "sense-adj"},
            {"sentence": "Regular walks help older adults stay active and independent.", "translation": "规律散步能帮助老年人保持活跃和独立。", "targetForm": "active", "senseId": "sense-adj"},
            {"sentence": "Active listening means giving the speaker your full attention.", "translation": "积极倾听意味着全神贯注地听对方说话。", "targetForm": "active", "senseId": "sense-adj"},
        ],
    },
    "drive": {
        "senseGroups": [
            {"id": "sense-v", "partOfSpeech": "v.", "sourceSenseIds": ["v-1", "v-2", "v-3", "v-4", "v-5", "v-6"], "sense": "开车；驱使；推动"},
            {"id": "sense-n", "partOfSpeech": "n.", "sourceSenseIds": ["n-1", "n-2", "n-3", "n-4", "n-5", "n-6", "n-7"], "sense": "驾车；驱动力；驱动器"},
        ],
        "examples": [
            {"sentence": "She drives to work when the weather is too bad for cycling.", "translation": "天气不适合骑车时，她开车去上班。", "targetForm": "drives", "senseId": "sense-v"},
            {"sentence": "Curiosity drives him to ask careful questions during every experiment.", "translation": "好奇心驱使他在每次实验中认真提问。", "targetForm": "drives", "senseId": "sense-v"},
            {"sentence": "Rising costs are driving small shops to reduce their opening hours.", "translation": "成本上涨正迫使小商店缩短营业时间。", "targetForm": "driving", "senseId": "sense-v"},
            {"sentence": "We took a scenic drive along the coast before sunset.", "translation": "日落前，我们沿海岸进行了一次风景优美的驾车旅行。", "targetForm": "drive", "senseId": "sense-n"},
            {"sentence": "Back up the files before replacing the hard drive in your computer.", "translation": "更换电脑硬盘前，请先备份文件。", "targetForm": "drive", "senseId": "sense-n"},
        ],
    },
    "collect": {
        "senseGroups": [{"id": "sense-v", "partOfSpeech": "v.", "sourceSenseIds": ["v-1", "v-2", "v-3", "v-4"], "sense": "收集；聚集；搜集"}],
        "examples": [
            {"sentence": "Researchers collected water samples from the river after the storm.", "translation": "暴风雨过后，研究人员从河中采集了水样。", "targetForm": "collected", "senseId": "sense-v"},
            {"sentence": "Please collect your ticket from the desk before entering the hall.", "translation": "进入大厅前，请到服务台领取你的票。", "targetForm": "collect", "senseId": "sense-v"},
            {"sentence": "The museum collects local photographs to preserve the town's history.", "translation": "博物馆收集当地照片，以保存小镇的历史。", "targetForm": "collects", "senseId": "sense-v"},
            {"sentence": "Children enjoy collecting leaves of different shapes in autumn.", "translation": "孩子们喜欢在秋天收集形状各异的树叶。", "targetForm": "collecting", "senseId": "sense-v"},
            {"sentence": "The library will collect suggestions before choosing next year's books.", "translation": "图书馆会在选择明年书目之前征集建议。", "targetForm": "collect", "senseId": "sense-v"},
        ],
    },
    "miniature": {
        "senseGroups": [
            {"id": "sense-n", "partOfSpeech": "n.", "sourceSenseIds": ["n-1", "n-2"], "sense": "缩图；小画像"},
            {"id": "sense-adj", "partOfSpeech": "adj.", "sourceSenseIds": ["adj-1", "adj-2"], "sense": "小规模的；微型的"},
        ],
        "examples": [
            {"sentence": "The museum displayed a miniature of the original painting beside the real work.", "translation": "博物馆把原画的缩图陈列在真迹旁边。", "targetForm": "miniature", "senseId": "sense-n"},
            {"sentence": "In the exhibition, a miniature portrait revealed the details of the clothing.", "translation": "在展览中，一幅小画像展现了服饰的细节。", "targetForm": "miniature", "senseId": "sense-n"},
            {"sentence": "The students built a miniature city to test changes in traffic flow.", "translation": "学生们建造了一座微型城市来测试交通流量的变化。", "targetForm": "miniature", "senseId": "sense-adj"},
            {"sentence": "Although the device is miniature, it records temperatures accurately.", "translation": "虽然这台设备体积很小，但它能准确记录温度。", "targetForm": "miniature", "senseId": "sense-adj"},
            {"sentence": "The architect used a miniature model to explain the bridge design.", "translation": "建筑师用一个微型模型来说明这座桥的设计。", "targetForm": "miniature", "senseId": "sense-adj"},
        ],
    },
    "remain": {
        "senseGroups": [{"id": "sense-v", "partOfSpeech": "v.", "sourceSenseIds": ["v-1", "v-2", "v-3", "v-4", "v-5", "v-6"], "sense": "保持；留下；剩余"}],
        "examples": [
            {"sentence": "The museum remains open until eight o'clock on Fridays.", "translation": "博物馆周五一直开放到晚上八点。", "targetForm": "remains", "senseId": "sense-v"},
            {"sentence": "Only two questions remain after the group finishes the report.", "translation": "小组完成报告后，只剩下两个问题。", "targetForm": "remain", "senseId": "sense-v"},
            {"sentence": "Please remain seated until the train has come to a complete stop.", "translation": "请保持坐姿，直到列车完全停稳。", "targetForm": "remain", "senseId": "sense-v"},
            {"sentence": "Despite the repairs, the bridge remains closed to heavy vehicles.", "translation": "尽管已经维修，这座桥仍不对重型车辆开放。", "targetForm": "remains", "senseId": "sense-v"},
            {"sentence": "Several old trees remained after the storm damaged the park.", "translation": "暴风雨损坏公园后，仍有几棵老树留了下来。", "targetForm": "remained", "senseId": "sense-v"},
        ],
    },
}


def read_js(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8-sig")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def self_authored_paths() -> list[Path]:
    """Load the historical starter set before later numbered corrections."""
    baseline = ROOT / "data" / "self-authored-examples.js"
    replacements = sorted(
        path for path in ROOT.glob("data/self-authored-examples*.js")
        if path != baseline
    )
    return ([baseline] if baseline.exists() else []) + replacements


def read_self_authored_entries() -> dict:
    """Merge only the explicitly self-authored, batch-reviewed entries."""
    entries: dict = {}
    for path in self_authored_paths():
        payload = read_js(path)
        # The original hand-reviewed file wraps records in ``entries``;
        # later numbered review batches store the word records directly.
        # Accept both formats so reviewed batch corrections participate in
        # the full-library release audit.
        entries.update(payload.get("entries", payload))
    return entries


def supplemental_paths() -> list[Path]:
    """Read additive reviewed pairs without replacing retained good pairs."""
    return sorted(ROOT.glob("data/self-authored-supplements*.js"))


def read_supplemental_entries() -> dict:
    entries: dict = {}
    for path in supplemental_paths():
        payload = read_js(path)
        for word, examples in payload.get("entries", payload).items():
            entries.setdefault(word, []).extend(examples)
    return entries


def normalize_direct_record(source_record: dict, direct_examples: list[dict], source_senses: list[dict]) -> dict:
    """Map lightweight source-sense IDs to the raw record's sense groups."""
    groups_by_source_id = {}
    for group in source_record.get("senseGroups", []):
        for source_sense_id in group.get("sourceSenseIds", []):
            groups_by_source_id[str(source_sense_id)] = group
    source_pos_by_id = {
        str(item.get("id", "")): str(item.get("partOfSpeech", "")).lower().rstrip(".")
        for item in source_senses
    }
    source_sense_by_id = {str(item.get("id", "")): item for item in source_senses}
    groups_by_pos: dict[str, list[dict]] = defaultdict(list)
    for group in source_record.get("senseGroups", []):
        groups_by_pos[str(group.get("partOfSpeech", "")).lower().rstrip(".")].append(group)
    selected_groups = []
    source_to_group_id = {}
    for example in direct_examples:
        source_sense_id = str(example.get("senseId", ""))
        group = groups_by_source_id.get(source_sense_id)
        if group is None:
            matching_groups = groups_by_pos.get(source_pos_by_id.get(source_sense_id, ""), [])
            group = matching_groups[0] if matching_groups else None
        if group is None and source_sense_id in source_sense_by_id:
            source_sense = source_sense_by_id[source_sense_id]
            group = {
                "id": f"direct-{source_sense_id}",
                "partOfSpeech": source_sense.get("partOfSpeech", ""),
                "sourceSenseIds": [source_sense_id],
                "sense": source_sense.get("sense", ""),
            }
        if group is None:
            continue
        group_id = str(group.get("id", ""))
        source_to_group_id[source_sense_id] = group_id
        if group_id not in {str(item.get("id", "")) for item in selected_groups}:
            selected_groups.append(copy.deepcopy(group))
    return {
        "senseGroups": selected_groups,
        "examples": [
            {**example, "senseId": source_to_group_id.get(str(example.get("senseId", "")), "")}
            for example in direct_examples
        ],
    }


def append_supplemental_examples(record: dict, source_record: dict, direct_examples: list[dict], source_senses: list[dict]) -> dict:
    """Add reviewed pairs, retaining five valid examples with POS coverage."""
    mapped = normalize_direct_record(source_record, direct_examples, source_senses)
    result = copy.deepcopy(record)
    groups = {str(group.get("id", "")): group for group in result.get("senseGroups", [])}
    for group in mapped["senseGroups"]:
        groups.setdefault(str(group.get("id", "")), group)
    result["senseGroups"] = list(groups.values())
    candidates = result["examples"] + mapped["examples"]
    required_parts = {
        str(item.get("partOfSpeech", "")).lower().rstrip(".")
        for item in source_senses
        if str(item.get("partOfSpeech", "")).lower().rstrip(".") in {"n", "v", "adj", "adv", "pron", "conj", "prep"}
    }
    chosen: list[dict] = []
    seen_sentences: set[str] = set()

    def add(example: dict) -> None:
        sentence = str(example.get("sentence", "")).strip().lower()
        if sentence and sentence not in seen_sentences and len(chosen) < 5:
            chosen.append(example)
            seen_sentences.add(sentence)

    for part in sorted(required_parts):
        for example in candidates:
            group = groups.get(str(example.get("senseId", "")))
            if group and str(group.get("partOfSpeech", "")).lower().rstrip(".") == part:
                add(example)
                break
    for example in candidates:
        add(example)
    result["examples"] = chosen
    return result


def read_codex_reviewed_entries() -> dict:
    if not CODEX_REVIEWED.exists():
        return {}
    return read_js(CODEX_REVIEWED).get("entries", {})


def terminal_count(value: str, punctuation: str) -> int:
    return sum(value.count(char) for char in punctuation)


def clearly_verb_form(form: str, word: str) -> bool:
    form = form.lower()
    # A headword may itself end in -ed or -ing while functioning as an
    # adjective, noun, preposition, or conjunction (for example,
    # ``accustomed``, ``painting``, and ``concerning``).  Only a form that
    # differs from the supplied headword can be treated as evidence of an
    # inflected verb here.
    if form == word.lower():
        return False
    if form in IRREGULAR_VERBS and form != word.lower():
        return True
    return form.endswith("ed") or form.endswith("ing")


def quality_reasons(word: str, example: dict, groups: dict[str, dict]) -> list[str]:
    sentence = " ".join(str(example.get("sentence", "")).split())
    translation = " ".join(str(example.get("translation", "")).split())
    target = str(example.get("targetForm", "")).strip()
    reasons = []
    if TEMPLATE.search(sentence):
        reasons.append("legacy-template")
    if UNSAFE.search(sentence) or UNSAFE.search(translation):
        reasons.append("unsafe-content")
    if not target or not WORD.pattern.format(form=re.escape(target)):
        reasons.append("invalid-target")
    elif not re.search(WORD.pattern.format(form=re.escape(target)), sentence, re.IGNORECASE):
        reasons.append("target-not-in-sentence")
    word_count = len(re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", sentence))
    if not 10 <= word_count <= 26:
        reasons.append("english-length")
    if not re.match(r"^[A-Z]", sentence) or not sentence.endswith("."):
        reasons.append("english-not-a-complete-declarative-sentence")
    if not CHINESE.search(translation) or not 6 <= len(translation) <= 72:
        reasons.append("translation-length")
    if not translation.endswith("。"):
        reasons.append("chinese-not-a-complete-sentence")
    if terminal_count(sentence, ".!?") != 1:
        reasons.append("multiple-english-sentences")
    if terminal_count(translation, "。！？") != 1:
        reasons.append("multiple-chinese-sentences")
    group = groups.get(str(example.get("senseId", "")))
    if not group:
        reasons.append("missing-sense-group")
    elif clearly_verb_form(target, word) and not str(group.get("partOfSpeech", "")).lower().startswith("v"):
        reasons.append("clear-form-pos-conflict")
    return reasons


def curatable_record(word: str, record: dict, issues: dict[str, list[dict]], source_senses: list[dict]) -> dict | None:
    groups = {str(group.get("id", "")): group for group in record.get("senseGroups", [])}
    accepted = []
    seen = set()
    for example in record.get("examples", []):
        reasons = quality_reasons(word, example, groups)
        sentence_key = " ".join(str(example.get("sentence", "")).lower().split())
        if sentence_key in seen:
            reasons.append("duplicate-sentence")
        if reasons:
            issues[word].append({"reasons": reasons, "sentence": str(example.get("sentence", "")), "translation": str(example.get("translation", ""))})
            continue
        seen.add(sentence_key)
        accepted.append({key: example[key] for key in ("sentence", "translation", "targetForm", "senseId")})
    if not accepted:
        return None
    # A safe-looking partial record is not sufficient for the learner-facing
    # library when the supplied dictionary lists more than one ordinary part
    # of speech.  Record the gap for the rewrite queue without throwing away
    # the individually valid pairs that can still be retained verbatim.
    required_parts = {
        str(item.get("partOfSpeech", "")).lower().rstrip(".")
        for item in source_senses
        if str(item.get("partOfSpeech", "")).lower().rstrip(".") in {"n", "v", "adj", "adv", "pron", "conj", "prep"}
    }
    covered_parts = {
        str(groups[example["senseId"]].get("partOfSpeech", "")).lower().rstrip(".")
        for example in accepted
    }
    missing_parts = sorted(required_parts - covered_parts)
    if missing_parts:
        issues[word].append({"reasons": ["missing-standard-pos-coverage:" + ",".join(missing_parts)], "sentence": "", "translation": ""})
    used = {example["senseId"] for example in accepted}
    return {"senseGroups": [copy.deepcopy(group) for group_id, group in groups.items() if group_id in used], "examples": accepted}


def main() -> None:
    parser = argparse.ArgumentParser(description="Conservatively curate a bilingual learning-example library.")
    parser.add_argument("--input", type=Path, default=SOURCE, help="candidate JavaScript library")
    parser.add_argument("--output", type=Path, default=SOURCE, help="curated JavaScript library")
    parser.add_argument("--report", type=Path, default=REPORT, help="JSON quality report")
    args = parser.parse_args()
    baseline = read_js(args.input)
    reviewed = read_js(REVIEWED)["entries"] if REVIEWED.exists() else {}
    strict_reviewed = read_js(STRICT_REVIEWED)["entries"] if STRICT_REVIEWED.exists() else {}
    self_authored = read_self_authored_entries()
    supplements = read_supplemental_entries()
    codex_reviewed = read_codex_reviewed_entries()
    source_senses = read_js(ROOT / "public" / "word-senses.js")["entries"]
    issues: dict[str, list[dict]] = defaultdict(list)
    release: dict[str, dict] = {}
    source_counts: Counter[str] = Counter()
    accepted_counts: dict[str, int] = {}
    for word, source_record in baseline["entries"].items():
        if word in self_authored:
            reviewed_record = copy.deepcopy(self_authored[word])
            if isinstance(reviewed_record, list):
                reviewed_record = normalize_direct_record(source_record, reviewed_record, source_senses.get(word, {}).get("senses", []))
            record = reviewed_record
            source_name = "self-authored-and-reviewed"
        elif word in codex_reviewed:
            record = copy.deepcopy(codex_reviewed[word])
            source_name = "codex-authored-and-reviewed"
        elif word in OVERRIDES:
            record = copy.deepcopy(OVERRIDES[word])
            source_name = "hand-reviewed-regression"
        elif word in strict_reviewed:
            record = strict_reviewed[word]
            source_name = "strictly-reviewed"
        elif word in reviewed:
            record = reviewed[word]
            source_name = "independently-reviewed"
        else:
            record = source_record
            source_name = "strictly-filtered-corpus"
        curated = curatable_record(word, record, issues, source_senses.get(word, {}).get("senses", []))
        if curated and word in supplements:
            supplemented = append_supplemental_examples(curated, source_record, supplements[word], source_senses.get(word, {}).get("senses", []))
            curated = curatable_record(word, supplemented, issues, source_senses.get(word, {}).get("senses", []))
        if curated:
            accepted_counts[word] = len(curated["examples"])
            if len(curated["examples"]) == 5:
                release[word] = curated
                source_counts[source_name] += len(curated["examples"])
            else:
                issues[word].append({"reasons": [f"expected-five-examples:{len(curated['examples'])}"], "sentence": "", "translation": ""})
        else:
            accepted_counts[word] = 0
    payload = {
        "source": "strict bilingual quality gate; reviewed entries; hand-reviewed regression examples",
        "generatedAt": baseline.get("generatedAt"),
        "entries": release,
    }
    args.output.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    rejected = Counter(reason for entries in issues.values() for item in entries for reason in item["reasons"])
    report = {
        "checkedWords": len(baseline["entries"]),
        "checkedExamples": sum(len(item.get("examples", [])) for item in baseline["entries"].values()),
        "publishedWords": len(release),
        "publishedExamples": sum(len(item["examples"]) for item in release.values()),
        "wordsBelowFiveExamples": sorted(word for word, count in accepted_counts.items() if count != 5),
        "missingExamplesToFive": sum(max(0, 5 - count) for count in accepted_counts.values()),
        "exampleShortfallByWord": {
            word: 5 - count for word, count in sorted(accepted_counts.items()) if count < 5
        },
        "wordsHeldForReviewedRewrite": sorted(set(baseline["entries"]) - set(release)),
        "rejectedByReason": dict(sorted(rejected.items())),
        "publishedBySource": dict(sorted(source_counts.items())),
        "blockedExamples": {word: entries for word, entries in sorted(issues.items()) if entries},
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("checkedWords", "checkedExamples", "publishedWords", "publishedExamples", "missingExamplesToFive", "rejectedByReason", "publishedBySource")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
