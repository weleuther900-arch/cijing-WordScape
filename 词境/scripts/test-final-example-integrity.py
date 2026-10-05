"""Regression checks for final-library integrity gates, without generated assets."""
import copy
import json
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("final_verifier", Path(__file__).with_name("verify-final-example-library.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.senses = {"n-1": {"sense": "零售"}, "v-2": {"sense": "转述"}}
        self.entry = {"senseGroups": [{"id": "one", "sourceSenseIds": ["n-1"], "partOfSpeech": "n.", "sense": "零售", "contextReviewed": True, "semanticDistinct": True}], "examples": [{"senseId": "one"}]}

    def errors(self):
        return verifier.structural_errors(self.entry, self.senses)

    def test_valid_structure_is_not_rejected(self):
        self.assertEqual(self.errors(), [])

    def test_cap(self):
        self.entry["examples"] *= 6
        self.assertIn("entry must contain one to five examples", self.errors())

    def test_empty_entry(self):
        self.entry["examples"] = []
        self.assertIn("entry must contain one to five examples", self.errors())

    def test_review_flag_cannot_hide_unknown_source(self):
        self.entry["senseGroups"][0]["sourceSenseIds"] = ["missing", "n-1"]
        self.assertIn("unknown or missing dictionary source sense", self.errors())

    def test_missing_example_for_group(self):
        group = copy.deepcopy(self.entry["senseGroups"][0])
        group.update(id="two", sourceSenseIds=["v-2"], sense="转述")
        self.entry["senseGroups"].append(group)
        self.assertIn("each sense group must have exactly one example", self.errors())

    def test_repeated_source_and_meaning(self):
        group = copy.deepcopy(self.entry["senseGroups"][0])
        group["id"] = "two"
        self.entry["senseGroups"].append(group)
        self.entry["examples"].append({"senseId": "two"})
        self.assertIn("dictionary source sense repeated across groups", self.errors())
        self.assertIn("duplicate contextual meaning", self.errors())

    def test_duplicate_group_id(self):
        self.entry["senseGroups"] *= 2
        self.assertIn("missing or duplicate sense group ID", self.errors())


class ReviewedCorrectionsTests(unittest.TestCase):
    def test_against_actual_dictionary_and_language_checks(self):
        root = Path(__file__).resolve().parents[1]
        corrections = json.loads((root / "content" / "semantic-reviewed-corrections.json").read_text(encoding="utf-8"))
        dictionary = verifier.js(root / "public" / "word-senses.js", "WORD_SENSE_LIBRARY")["entries"]
        for word, senses in corrections.get("dictionaryOverrides", {}).items():
            self.assertIn(word, dictionary)
            dictionary[word] = {"senses": senses}
        language_checks = verifier.tools()
        for word, entry in corrections["entries"].items():
            with self.subTest(word=word):
                known = {sense["id"]: sense for sense in dictionary[word]["senses"]}
                self.assertEqual(verifier.structural_errors(entry, known), [])
                groups = {group["id"] for group in entry["senseGroups"]}
                for example in entry["examples"]:
                    valid, reason = language_checks.strictly_valid(word, example, groups)
                    self.assertTrue(valid, reason)


if __name__ == "__main__":
    unittest.main()
