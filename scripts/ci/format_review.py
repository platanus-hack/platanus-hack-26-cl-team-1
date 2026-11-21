#!/usr/bin/env python3
"""Render a code-review agent's structured output as a pull request review body.

Input on stdin is the JSON the agent returned through its output schema:
    {"summary": str, "findings": [{"severity": "blocking" | "non_blocking",
                                   "file": str, "line": int | null,
                                   "claim": str, "failure_scenario": str}]}

The agent's output is untrusted, so anything that doesn't match that shape is
an error and no review is posted. The verdict is derived from the findings
rather than stated by the agent, so the two can't disagree.

Exit codes: 0 prints a body with no blocking finding, EXIT_BLOCKING prints a
body that holds the merge, and 1 prints nothing because the input was invalid.
"""

from __future__ import annotations

import argparse
import enum
import json
import sys
from dataclasses import dataclass

FINDING_KEYS = {"severity", "file", "line", "claim", "failure_scenario"}
REVIEW_KEYS = {"summary", "findings"}
SHORT_SHA_LENGTH = 7
EXIT_BLOCKING = 2


class Severity(enum.Enum):
    BLOCKING = "blocking"
    NON_BLOCKING = "non_blocking"


def _text(raw: dict, key: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string, got {value!r}")
    return value.strip()


def _exact_keys(raw: object, expected: set[str], name: str) -> dict:
    if not isinstance(raw, dict) or set(raw) != expected:
        raise ValueError(f"{name} must have exactly the keys {sorted(expected)}, got {raw!r}")
    return raw


@dataclass(frozen=True)
class Finding:
    severity: Severity
    file: str
    line: int | None
    claim: str
    failure_scenario: str

    @classmethod
    def parse(cls, raw: object) -> Finding:
        fields = _exact_keys(raw, FINDING_KEYS, "finding")
        line = fields["line"]
        is_line_number = type(line) is int and line >= 1
        if line is not None and not is_line_number:
            raise ValueError(f"line must be a positive integer or null, got {line!r}")
        return cls(
            severity=Severity(fields["severity"]),
            file=_text(fields, "file"),
            line=line,
            claim=_text(fields, "claim"),
            failure_scenario=_text(fields, "failure_scenario"),
        )

    @property
    def location(self) -> str:
        return self.file if self.line is None else f"{self.file}:{self.line}"


@dataclass(frozen=True)
class Review:
    summary: str
    findings: tuple[Finding, ...]

    @classmethod
    def parse(cls, raw: object) -> Review:
        fields = _exact_keys(raw, REVIEW_KEYS, "review")
        if not isinstance(fields["findings"], list):
            raise ValueError(f"findings must be a list, got {fields['findings']!r}")
        return cls(
            summary=_text(fields, "summary"),
            findings=tuple(Finding.parse(finding) for finding in fields["findings"]),
        )

    def of_severity(self, severity: Severity) -> list[Finding]:
        return [finding for finding in self.findings if finding.severity is severity]


def _section(title: str, findings: list[Finding]) -> list[str]:
    if not findings:
        return []
    lines = [f"#### {title}", ""]
    for finding in findings:
        lines.append(f"- `{finding.location}`: {finding.claim}")
        lines.append(f"  - **Fails when:** {finding.failure_scenario}")
    return [*lines, ""]


VERDICT_BLOCKING = "Its blocking findings hold the merge."
VERDICT_CLEAR = "Nothing here holds the merge."


def render(review: Review, reviewer: str, head_sha: str) -> str:
    blocking = review.of_severity(Severity.BLOCKING)
    non_blocking = review.of_severity(Severity.NON_BLOCKING)
    verdict = VERDICT_BLOCKING if blocking else VERDICT_CLEAR
    lines = [
        f"### {reviewer}: {len(blocking)} blocking, {len(non_blocking)} non-blocking",
        "",
        f"Reviewed `{head_sha[:SHORT_SHA_LENGTH]}`. {verdict}",
        "",
        review.summary,
        "",
        *_section("Blocking", blocking),
        *_section("Non-blocking", non_blocking),
    ]
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None, stdin=sys.stdin) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--head-sha", required=True)
    args = parser.parse_args(argv)
    try:
        review = Review.parse(json.load(stdin))
    except ValueError as error:
        print(f"format_review: {error}", file=sys.stderr)
        return 1
    print(render(review, args.reviewer, args.head_sha), end="")
    return EXIT_BLOCKING if review.of_severity(Severity.BLOCKING) else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
