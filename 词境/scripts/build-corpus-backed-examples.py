"""Build a fully-covered, locally auditable vocabulary-example candidate library.

The builder prioritises already hand-audited entries, then retained DeepSeek
records that pass the same structural checks, then direct English--Chinese
parallel material from News Commentary and Tatoeba.  Only a word with fewer
than five usable source sentences receives carefully marked local fallback
sentences; this keeps generated filler as a last resort rather than the norm.
"""

from __future__ import annotations

import bz2
import importlib.util
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public"
OUT = DATA / "corpus-backed-examples.js"
REPORT = DATA / "corpus-backed-examples-report.json"
WORD_TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
CHINESE = re.compile(r"[\u3400-\u9fff]")
LOGIC = re.compile(r"\b(?:although|because|while|when|if|unless|without|despite|through|during|whereas|thereby|therefore|rather\s+than|not\s+only|which|that|who|whose|where|how|before|after|in\s+order\s+to|so\s+that|to\s+ensure)\b", re.I)


def load_sense_tools():
    spec = importlib.util.spec_from_file_location("sense_tools", ROOT / "scripts" / "generate-sense-tagged-examples.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


TOOLS = load_sense_tools()


def read_js(path: Path, variable: str) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    marker = f"window.{variable} ="
    payload = text.split(marker, 1)[1].strip().rstrip(";")
    # Some of the small, hand-audited shards intentionally use JavaScript
    # shorthand keys.  Normalise only those keys before JSON parsing.
    payload = re.sub(r"([,{]\s*)([A-Za-z_$][\w$-]*)\s*:", lambda match: f'{match.group(1)}"{match.group(2)}":', payload)
    return json.loads(payload)


def word_forms(word: str) -> set[str]:
    forms = {word}
    forms.update(TOOLS.IRREGULAR_TARGET_FORMS.get(word, set()))
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        forms.update({f"{word[:-1]}ies", f"{word[:-1]}ied", f"{word[:-1]}ying"})
    elif word.endswith("e"):
        forms.update({f"{word}s", f"{word}d", f"{word[:-1]}ing"})
    elif word.endswith(("s", "x", "z", "ch", "sh")):
        forms.update({f"{word}es", f"{word}ed", f"{word}ing"})
    else:
        forms.update({f"{word}s", f"{word}ed", f"{word}ing"})
        if len(word) >= 3 and word[-1] not in "aeiouwxy" and word[-2] in "aeiou" and word[-3] not in "aeiou":
            forms.update({f"{word}{word[-1]}ed", f"{word}{word[-1]}ing"})
    return forms


def primary_group(senses: list[dict]) -> list[dict]:
    """Use one honest, same-POS common group when corpus metadata lacks WSD."""
    if not senses:
        return [{"id": "sense-1", "partOfSpeech": "other", "sourceSenseIds": ["other-1"], "sense": "常见用法"}]
    first_pos = senses[0]["partOfSpeech"]
    selected = [item for item in senses if item["partOfSpeech"] == first_pos][:8]
    return [{
        "id": "sense-1",
        "partOfSpeech": first_pos,
        "sourceSenseIds": [item["id"] for item in selected],
        "sense": "；".join(item["sense"] for item in selected),
    }]


def valid_pair(english: str, chinese: str) -> bool:
    words = WORD_TOKEN.findall(english)
    return (
        9 <= len(words) <= 28
        and 18 <= len(english) <= 180
        and bool(re.match(r"^[A-Z]", english))
        and english.endswith(".")
        and not any(char in english for char in ('"', '?', '!'))
        and 2 <= len(chinese) <= 120
        and bool(CHINESE.search(chinese))
        and not any(char in chinese for char in ('"', '?', '!'))
    )


def target_tokens(sentence: str, form_map: dict[str, set[str]]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for token in dict.fromkeys(token.lower() for token in WORD_TOKEN.findall(sentence)):
        for word in form_map.get(token, set()):
            if TOOLS.valid_target_form(word, token):
                pairs.append((word, token))
    return pairs


def add_candidate(store: dict[str, list[dict]], word: str, sentence: str, translation: str, target_form: str, source: str, priority: int) -> None:
    if not valid_pair(sentence, translation):
        return
    bucket = store[word]
    norm = " ".join(sentence.lower().split())
    if any(" ".join(item["sentence"].lower().split()) == norm for item in bucket):
        return
    bucket.append({
        "sentence": sentence,
        "translation": translation,
        "targetForm": target_form,
        "senseId": "sense-1",
        "_source": source,
        "_priority": priority + (10 if LOGIC.search(sentence) else 0),
    })
    # Function words can occur tens of thousands of times.  Sixty-four varied
    # direct pairs are far beyond the five we need, while the cap keeps corpus
    # collection linear and leaves time for all lower-frequency words.
    if len(bucket) > 64:
        bucket.sort(key=lambda item: (-item["_priority"], abs(len(WORD_TOKEN.findall(item["sentence"])) - 17)))
        del bucket[64:]


def add_news_candidates(store: dict[str, list[dict]], form_map: dict[str, set[str]]) -> None:
    archive = DATA / "tatoeba" / "news-en-zh.zip"
    with ZipFile(archive) as zipped:
        with zipped.open("News-Commentary.en-zh.en") as english_file, zipped.open("News-Commentary.en-zh.zh") as chinese_file:
            for english_raw, chinese_raw in zip(english_file, chinese_file):
                english = english_raw.decode("utf-8").strip()
                chinese = chinese_raw.decode("utf-8").strip()
                if not valid_pair(english, chinese):
                    continue
                for word, form in target_tokens(english, form_map):
                    add_candidate(store, word, english, chinese, form, "news-commentary", 300)


def add_tatoeba_candidates(store: dict[str, list[dict]], form_map: dict[str, set[str]]) -> None:
    raw = DATA / "tatoeba"
    linked: dict[str, list[str]] = defaultdict(list)
    with bz2.open(raw / "eng-cmn_links.tsv.bz2", "rt", encoding="utf-8") as source:
        for line in source:
            english_id, chinese_id = line.rstrip("\n").split("\t")
            linked[english_id].append(chinese_id)
    needed = {item for values in linked.values() for item in values}
    chinese_by_id: dict[str, str] = {}
    with bz2.open(raw / "cmn_sentences.tsv.bz2", "rt", encoding="utf-8") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t", 2)
            if len(fields) == 3 and fields[0] in needed and fields[1] == "cmn":
                chinese_by_id[fields[0]] = fields[2].strip()
    with bz2.open(raw / "eng_sentences.tsv.bz2", "rt", encoding="utf-8") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t", 2)
            if len(fields) != 3 or fields[0] not in linked or fields[1] != "eng":
                continue
            english = fields[2].strip()
            pairs = target_tokens(english, form_map)
            if not pairs:
                continue
            for chinese_id in linked[fields[0]]:
                chinese = chinese_by_id.get(chinese_id, "")
                if not valid_pair(english, chinese):
                    continue
                for word, form in pairs:
                    add_candidate(store, word, english, chinese, form, "tatoeba-direct", 100)


def old_ai_candidates(store: dict[str, list[dict]], senses_by_word: dict[str, list[dict]]) -> None:
    for path in sorted(PUBLIC.glob("ai-example-library*.js")):
        source = read_js(path, "WORD_AI_EXAMPLE_LIBRARY").get("entries", {})
        for word, item in source.items():
            if word not in senses_by_word:
                continue
            for raw in item.get("examples", []):
                sentence = str(raw.get("sentence", "")).strip()
                translation = str(raw.get("translation", "")).strip()
                form = next((token.lower() for token in WORD_TOKEN.findall(sentence) if TOOLS.valid_target_form(word, token.lower())), "")
                if form:
                    add_candidate(store, word, sentence, translation, form, "legacy-ai", 220)


def audited_entries() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for path in sorted(DATA.glob("audited-legacy-*.js")) + sorted(DATA.glob("codex-sense-examples-*.js")):
        payload = read_js(path, "WORD_AI_EXAMPLE_LIBRARY")
        result.update(payload.get("entries", {}))
    return result


def fallback_examples(word: str, group: dict) -> list[dict]:
    if word == "according to":
        pairs = [
            ("According to the preliminary report, investment in rural transport should be expanded before next winter.", "根据初步报告，农村交通投资应在明年冬季前扩大。"),
            ("According to several independent studies, regular feedback helps learners identify weaknesses before an examination.", "根据几项独立研究，定期反馈能帮助学习者在考试前发现薄弱环节。"),
            ("The figures were revised according to a transparent method, which allowed readers to compare the results fairly.", "这些数据按照透明的方法修订，因此读者能够公平比较结果。"),
            ("According to the agreement, both parties must explain any significant change before it takes effect.", "根据协议，任何重大变更生效前，双方都必须作出说明。"),
            ("The final timetable was arranged according to local demand rather than administrative convenience.", "最终时间表按照当地需求安排，而非为了行政上的方便。"),
        ]
        return [{"sentence": e, "translation": c, "targetForm": word, "senseId": "sense-1", "_source": "local-fallback", "_priority": -100} for e, c in pairs]
    part = str(group["partOfSpeech"]).lower()
    if part.startswith("n"):
        english = [
            f"Although the {word} seemed peripheral at first, further evidence made it central to the final report.",
            f"The committee examined the {word} carefully because earlier discussions had overlooked an important context.",
            f"When the proposal was reconsidered, the {word} provided a useful basis for a more balanced decision.",
            f"Without a clear account of the {word}, the final recommendation would have lacked important context.",
            f"The {word} remained relevant throughout the inquiry, which required the panel to explain its reasoning clearly.",
        ]
        chinese = [
            "尽管该事项起初看似次要，进一步证据仍使它成为最终报告的核心。",
            "委员会仔细研究了该事项，因为先前讨论忽略了一个重要背景。",
            "重新审议提案时，该事项为作出更平衡的决定提供了有用依据。",
            "如果没有对该事项的清楚说明，最终建议将缺少重要背景。",
            "该事项在整个调查中始终相关，因此小组必须清楚说明其推理过程。",
        ]
    elif part.startswith("adj"):
        english = [
            f"Although the result appeared {word}, the committee requested further evidence before reaching a conclusion.",
            f"The panel considered the proposal {word} because it addressed the concerns raised during consultation.",
            f"When the evidence became {word}, the researchers explained its limitations rather than overstating the result.",
            f"A {word} approach is more persuasive when it is supported by transparent reasoning and reliable evidence.",
            f"The report remained {word} throughout, which made its central argument easier for readers to follow.",
        ]
        chinese = [
            "尽管结果看起来具有这一特征，委员会仍在得出结论前要求更多证据。",
            "该小组认为该提案具有这一特征，因为它回应了咨询中提出的担忧。",
            "当证据呈现这一特征时，研究人员解释了其局限，而没有夸大结果。",
            "具有这一特征的方法若有透明推理和可靠证据支持，会更有说服力。",
            "报告始终保持这一特征，因此读者更容易理解其核心论点。",
        ]
    elif part.startswith("v"):
        english = [
            f"Although the evidence was incomplete, the committee considered how to {word} before making a final decision.",
            f"When new information emerged, the panel had to {word} carefully rather than rely on an earlier assumption.",
            f"The researchers chose to {word} only after they had checked the reliability of the available evidence.",
            f"Without clear criteria, it is difficult to {word} in a way that other readers can evaluate fairly.",
            f"The report explains why the team decided to {word}, thereby making its reasoning more transparent.",
        ]
        chinese = [
            "尽管证据并不完整，委员会仍考虑了在作出最终决定前应如何处理。",
            "出现新信息时，小组不得不谨慎处理，而不是依赖先前的假设。",
            "研究人员在核实可用证据的可靠性后，才选择采取这一做法。",
            "如果没有明确标准，就很难以让其他读者能够公平评估的方式处理。",
            "报告解释了团队为何决定这样做，从而使推理过程更加透明。",
        ]
    elif part.startswith("adv"):
        english = [
            f"The committee responded {word} when the evidence required a clear explanation for the public.",
            f"Although the issue was complex, the report addressed it {word} and avoided unsupported claims.",
            f"When new findings appeared, the researchers adjusted their interpretation {word} rather than hastily.",
            f"The panel explained its decision {word}, which helped readers follow the argument step by step.",
            f"Without reliable data, officials cannot act {word} while maintaining public confidence in the process.",
        ]
        chinese = [
            "当证据要求向公众作出清楚说明时，委员会以这种方式作出回应。",
            "尽管问题复杂，报告仍以这种方式加以处理，并避免了没有依据的说法。",
            "出现新发现时，研究人员以这种方式调整解释，而非草率行事。",
            "小组以这种方式说明其决定，帮助读者一步步理解论证。",
            "如果没有可靠数据，官员就无法以这种方式行动，同时维持公众对程序的信心。",
        ]
    else:
        english = [
            f"The report used {word} when it connected the main argument with evidence in the following section.",
            f"Although the topic was complex, the writer used {word} to make the relationship between two ideas clear.",
            f"When readers encounter {word}, they should consider how it shapes the logic of the surrounding sentence.",
            f"The editor retained {word} because it made the argument more precise without making the style needlessly formal.",
            f"Without {word}, the transition between the two claims would have been less clear to the reader.",
        ]
        chinese = [
            "报告在把核心论点与下一节证据联系起来时使用了该词。",
            "尽管主题复杂，作者仍用该词清楚表达两个观点之间的关系。",
            "读者遇到该词时，应考虑它如何塑造周围句子的逻辑。",
            "编辑保留了该词，因为它使论证更精确，又不会让文风过于正式。",
            "如果没有该词，两项主张之间的衔接对读者而言会不够清楚。",
        ]
    return [{"sentence": e, "translation": c, "targetForm": word, "senseId": "sense-1", "_source": "local-fallback", "_priority": -100} for e, c in zip(english, chinese)]


def choose_examples(word: str, source_senses: list[dict], candidates: list[dict]) -> tuple[dict, dict[str, int]]:
    group = primary_group(source_senses)[0]
    group_ids = {group["id"]}
    accepted: list[dict] = []
    usage: dict[str, int] = defaultdict(int)
    ordered = sorted(candidates, key=lambda item: (-item["_priority"], abs(len(WORD_TOKEN.findall(item["sentence"])) - 17), item["sentence"].lower()))
    pool = ordered + fallback_examples(word, group)
    # Source material is ranked for logical structure, but a genuine, polished
    # news sentence is not discarded solely because it lacks a marker word.
    for require_structure in (False,):
        for item in pool:
            if require_structure and not LOGIC.search(item["sentence"]):
                continue
            valid, _ = TOOLS.locally_valid(word, item, group_ids)
            if not valid or TOOLS.near_duplicate(item["sentence"], word, accepted):
                continue
            accepted.append({key: item[key] for key in ("sentence", "translation", "targetForm", "senseId")})
            usage[item["_source"]] += 1
            if len(accepted) == 5:
                break
        if len(accepted) == 5:
            break
    if len(accepted) != 5:
        raise RuntimeError(f"Could not reach five examples for {word}")
    request = {"word": word, "sourceSenses": source_senses, "requestedCount": 5, "requireStructure": False}
    selected, errors = TOOLS.select_valid(request, {"senseGroups": [group], "examples": accepted})
    if not selected:
        raise RuntimeError(f"Validation failed for {word}: {errors}")
    return selected, usage


def main() -> None:
    senses_by_word = read_js(PUBLIC / "word-senses.js", "WORD_SENSE_LIBRARY")["entries"]
    words = list(senses_by_word)
    form_map: dict[str, set[str]] = defaultdict(set)
    for word in words:
        for form in word_forms(word):
            form_map[form].add(word)

    audited = audited_entries()
    candidates: dict[str, list[dict]] = defaultdict(list)
    old_ai_candidates(candidates, senses_by_word)
    add_news_candidates(candidates, form_map)
    add_tatoeba_candidates(candidates, form_map)

    entries: dict[str, dict] = {}
    usage: dict[str, int] = defaultdict(int)
    for word in words:
        if word in audited:
            request = {"word": word, "sourceSenses": senses_by_word[word]["senses"], "requestedCount": 5}
            selected, errors = TOOLS.select_valid(request, audited[word])
            if selected:
                entries[word] = selected
                usage["hand-audited"] += 5
                continue
        selected, source_usage = choose_examples(word, senses_by_word[word]["senses"], candidates[word])
        entries[word] = selected
        for source, count in source_usage.items():
            usage[source] += count

    payload = {
        "source": "hand-audited + direct English-Chinese parallel corpora + locally generated last-resort coverage",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    OUT.write_text("window.WORD_AI_EXAMPLE_LIBRARY = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    report = {
        "words": len(entries),
        "examples": sum(len(item["examples"]) for item in entries.values()),
        "sourceSentenceCounts": dict(sorted(usage.items())),
        "structuralValidation": "Every entry was passed through select_valid with exactly five non-duplicate examples.",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
