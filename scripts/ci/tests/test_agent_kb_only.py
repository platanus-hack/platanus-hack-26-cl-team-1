import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout

from scripts.ci import agent_kb_only as ako


def changed(filename, previous=None):
    file = {"filename": filename}
    if previous is not None:
        file["previous_filename"] = previous
    return file


class ChangesOnlyAgentKbTests(unittest.TestCase):
    def test_decides_from_every_path(self):
        cases = [
            ("one log", [changed("agent-kb/sessions/a.md")], True),
            ("several files", [changed("agent-kb/backlog.md"), changed("agent-kb/d.md")], True),
            ("rename within", [changed("agent-kb/new.md", previous="agent-kb/old.md")], True),
            ("mixed", [changed("agent-kb/backlog.md"), changed("server/app/a.py")], False),
            ("outside only", [changed("README.md")], False),
            ("rename into", [changed("agent-kb/a.py", previous="server/app/a.py")], False),
            ("rename out", [changed("docs/a.md", previous="agent-kb/a.md")], False),
            ("lookalike directory", [changed("agent-kb-old/a.md")], False),
            ("no files", [], False),
        ]
        for name, files, expected in cases:
            with self.subTest(name):
                self.assertIs(ako.changes_only_agent_kb(files, len(files)), expected)

    def test_rejects_truncated_listing(self):
        with self.assertRaisesRegex(ValueError, "listed 1 files, pull request reports 2"):
            ako.changes_only_agent_kb([changed("agent-kb/a.md")], 2)


class MainTests(unittest.TestCase):
    def run_main(self, text, expected_count):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = ako.main(["--expected-count", str(expected_count)], io.StringIO(text))
        return code, out.getvalue(), err.getvalue()

    def test_prints_true_for_agent_kb_only(self):
        text = json.dumps(changed("agent-kb/a.md")) + "\n"
        self.assertEqual(self.run_main(text, 1), (0, "true\n", ""))

    def test_prints_false_for_other_paths(self):
        text = json.dumps(changed("web/src/a.ts")) + "\n"
        self.assertEqual(self.run_main(text, 1), (0, "false\n", ""))

    def test_empty_input_with_no_expected_files_is_false(self):
        self.assertEqual(self.run_main("", 0), (0, "false\n", ""))

    def test_fails_without_a_decision_on_bad_input(self):
        cases = [
            ("invalid json", "{\n", 1),
            ("missing filename", '{"status": "added"}\n', 1),
            ("count mismatch", json.dumps(changed("agent-kb/a.md")) + "\n", 2),
        ]
        for name, text, expected_count in cases:
            with self.subTest(name):
                code, out, err = self.run_main(text, expected_count)
                self.assertEqual((code, out), (1, ""))
                self.assertIn("agent_kb_only", err)
