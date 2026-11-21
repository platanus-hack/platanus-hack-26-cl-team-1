import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout

from scripts.ci import format_review as fr


def finding(**overrides):
    fields = {
        "severity": "blocking",
        "file": "server/app/a.py",
        "line": 12,
        "claim": "Falls back silently.",
        "failure_scenario": "An empty list returns 0.",
    }
    return {**fields, **overrides}


class ParseTests(unittest.TestCase):
    def test_rejects_malformed_findings(self):
        missing_claim = finding()
        del missing_claim["claim"]
        cases = [
            ("not an object", "nope"),
            ("missing key", missing_claim),
            ("extra key", finding(verdict="approve")),
            ("unknown severity", finding(severity="critical")),
            ("empty file", finding(file=" ")),
            ("non-string claim", finding(claim=3)),
            ("zero line", finding(line=0)),
            ("string line", finding(line="12")),
            ("boolean line", finding(line=True)),
        ]
        for name, raw in cases:
            with self.subTest(name), self.assertRaises(ValueError):
                fr.Finding.parse(raw)

    def test_accepts_file_level_finding(self):
        self.assertIsNone(fr.Finding.parse(finding(line=None)).line)

    def test_rejects_malformed_reviews(self):
        cases = [
            ("not an object", []),
            ("missing findings", {"summary": "ok"}),
            ("findings not a list", {"summary": "ok", "findings": {}}),
            ("empty summary", {"summary": "", "findings": []}),
        ]
        for name, raw in cases:
            with self.subTest(name), self.assertRaises(ValueError):
                fr.Review.parse(raw)


class RenderTests(unittest.TestCase):
    def test_groups_blocking_before_non_blocking_whatever_the_input_order(self):
        review = fr.Review.parse(
            {
                "summary": "Two issues.",
                "findings": [
                    finding(severity="non_blocking", file="b.py", line=None, claim="Nit."),
                    finding(claim="Bug."),
                ],
            }
        )
        expected = (
            "### Sonnet: 1 blocking, 1 non-blocking\n"
            "\n"
            "Reviewed `abcdef1`. Its blocking findings hold the merge.\n"
            "\n"
            "Two issues.\n"
            "\n"
            "#### Blocking\n"
            "\n"
            "- `server/app/a.py:12`: Bug.\n"
            "  - **Fails when:** An empty list returns 0.\n"
            "\n"
            "#### Non-blocking\n"
            "\n"
            "- `b.py`: Nit.\n"
            "  - **Fails when:** An empty list returns 0.\n"
        )
        self.assertEqual(fr.render(review, "Sonnet", "abcdef1234"), expected)

    def test_review_without_findings_has_no_sections(self):
        review = fr.Review.parse({"summary": "Nothing survived.", "findings": []})
        expected = (
            "### Haiku: 0 blocking, 0 non-blocking\n"
            "\n"
            "Reviewed `abcdef1`. Nothing here holds the merge.\n"
            "\n"
            "Nothing survived.\n"
        )
        self.assertEqual(fr.render(review, "Haiku", "abcdef1234"), expected)


class MainTests(unittest.TestCase):
    def run_main(self, text):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = fr.main(["--reviewer", "Haiku", "--head-sha", "abcdef1234"], io.StringIO(text))
        return code, out.getvalue(), err.getvalue()

    def test_prints_body(self):
        code, out, err = self.run_main(json.dumps({"summary": "Fine.", "findings": []}))
        self.assertEqual((code, err), (0, ""))
        self.assertIn("### Haiku: 0 blocking, 0 non-blocking", out)
        self.assertIn(fr.VERDICT_CLEAR, out)

    def test_blocking_finding_prints_body_and_exits_with_the_blocking_code(self):
        code, out, err = self.run_main(json.dumps({"summary": "Bug.", "findings": [finding()]}))
        self.assertEqual((code, err), (2, ""))
        self.assertIn("### Haiku: 1 blocking, 0 non-blocking", out)

    def test_non_blocking_finding_exits_clean(self):
        review = {"summary": "Nit.", "findings": [finding(severity="non_blocking")]}
        code, out, err = self.run_main(json.dumps(review))
        self.assertEqual((code, err), (0, ""))
        self.assertIn("### Haiku: 0 blocking, 1 non-blocking", out)

    def test_posts_nothing_on_bad_output(self):
        cases = [
            ("no output", ""),
            ("invalid json", "{"),
            ("wrong shape", json.dumps({"summary": "Fine."})),
        ]
        for name, text in cases:
            with self.subTest(name):
                code, out, err = self.run_main(text)
                self.assertEqual((code, out), (1, ""))
                self.assertIn("format_review", err)
