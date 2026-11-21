#!/usr/bin/env python3
"""Print `true` if a pull request changes only files under agent-kb/, else `false`.

Input is one JSON object per line, one per changed file, as emitted by:
    gh api --paginate repos/OWNER/REPO/pulls/N/files --jq '.[]'

A rename counts both of its paths, so moving a file from server/ into agent-kb/
is not an agent-kb-only change. The listing API truncates very large pull
requests, so a listing that doesn't match the pull request's `changed_files`
is an error rather than a decision made on partial data.
"""

from __future__ import annotations

import argparse
import json
import sys

AGENT_KB_PREFIX = "agent-kb/"


def changes_only_agent_kb(files: list[dict], expected_count: int) -> bool:
    if len(files) != expected_count:
        raise ValueError(f"listed {len(files)} files, pull request reports {expected_count}")
    if not files:
        return False
    paths = [file["filename"] for file in files]
    paths += [file["previous_filename"] for file in files if "previous_filename" in file]
    return all(path.startswith(AGENT_KB_PREFIX) for path in paths)


def main(argv=None, stdin=sys.stdin) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-count", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        files = [json.loads(line) for line in stdin]
        is_agent_kb_only = changes_only_agent_kb(files, args.expected_count)
    except (KeyError, ValueError) as error:
        print(f"agent_kb_only: {error!r}", file=sys.stderr)
        return 1
    print("true" if is_agent_kb_only else "false")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
