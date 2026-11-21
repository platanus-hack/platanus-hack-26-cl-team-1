"""Review a recorded run: where does it go wrong, perception (the VLM) or the controller?

A run is a `SUP_VLM_RECORD_DIR`: `calls.jsonl` (one line per VLM call: frames, next steps, raw answer,
parsed output) plus the JPEGs the model saw. This tool:

1. **Replays the controller** over the recorded observations, so each call shows what the supervisor did
   with it (step done, mistake, what it said). The replay is checked against the next steps recorded live.
2. Lets you **label the truth** in a browser: for each call, which action was really happening (keys 1-9,
   0 = nothing; a label holds for the following calls until the next one). Saved to `labels.json`.
3. With labels, it **separates the two errors**:
   - perception: accuracy per call, the confusion matrix, and how many real actions were never seen at all
   - controller: the same controller replayed on the labels (an oracle perception). If the oracle run
     is fine and the model run isn't, the problem is perception; if both fail, the controller or the task.

    cd server && uv run python -m app.perception.review ../.context/webcam-runs/1814   # opens a browser
    cd server && uv run python -m app.perception.review ../.context/webcam-runs/1814 --report # text only
"""

from __future__ import annotations

import argparse
import json
import webbrowser
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from contracts import Controller, Event, Observation, Quality, Source, Task, VlmOutput

from ..controller.rules import RulesController
from ..library.store import TaskLibrary
from ..settings import REPO_ROOT

NONE = "none"  # label: nothing from the task is happening


@dataclass
class Session:
    id: str
    task: Task
    calls: list[dict]


def load_sessions(run_dir: Path, library: TaskLibrary) -> list[Session]:
    """Group the recorded calls by session. Runs recorded before calls carried a session id are split
    where the call counter restarts (every session has its own `VlmPerception`)."""
    groups: dict[str, list[dict]] = defaultdict(list)
    previous, fallback = 0, 0
    for line in (run_dir / "calls.jsonl").read_text().splitlines():
        call = json.loads(line)
        if "session" not in call:
            if call["call"] <= previous:
                fallback += 1
            call["session"] = f"s{fallback:02d}"
        previous = call["call"]
        groups[call["session"]].append(call)
    sessions = []
    for sid, calls in groups.items():
        task = library.get(calls[0]["task"])
        if task is None:
            raise ValueError(f"session {sid}: task {calls[0]['task']!r} is not in the library")
        sessions.append(Session(sid, task, calls))
    return sessions


def effective_labels(session: Session, labels: dict[str, str]) -> list[str | None]:
    """A label holds from its call until the next labelled call; calls before the first label are None."""
    current: str | None = None
    out = []
    for call in session.calls:
        current = labels.get(f"{session.id}:{call['call']}", current)
        out.append(current)
    return out


def replay(
    task: Task, calls: Sequence[dict], outputs: Sequence[VlmOutput], controller: Controller
) -> list[dict]:
    """Feed `outputs` (one per call) to a fresh controller the way the session does: a tick on the client
    clock, then the observation. Returns, per call, the next steps before it and what the controller did."""
    decision = controller.start(task)
    rows = []
    for call, output in zip(calls, outputs, strict=True):
        t_ms = call["t_ms"][-1]
        said = []
        if (reminder := controller.tick(t_ms)) is not None:
            decision = reminder
            said.append(reminder.say.text if reminder.say else "")
        before = list(decision.next_steps)
        observation = Observation(
            seq=call["seqs"][-1], t_ms=t_ms, source=Source.WEBCAM, model="replay", latency_ms=0, output=output
        )
        decision = controller.decide(observation)
        if decision.say:
            said.append(decision.say.text)
        rows.append(
            {
                "next_before": before,
                "event": decision.event.value,
                "step": decision.step,
                "mistake": decision.mistake_kind.value if decision.mistake_kind else None,
                "say": " / ".join(s for s in said if s),
                "done": sorted(s for s, v in decision.statuses.items() if v.value == "done"),
            }
        )
    return rows


def oracle_outputs(labels: Sequence[str | None]) -> list[VlmOutput]:
    return [
        VlmOutput(action=label, confidence=1.0, quality=Quality.OK)
        if label not in (None, NONE)
        else VlmOutput(action=None, confidence=1.0, quality=Quality.UNKNOWN)
        for label in labels
    ]


def segments(labels: Sequence[str | None]) -> list[tuple[str, int, int]]:
    """Runs of the same real action: (action, first index, last index), `none` and unlabelled excluded."""
    out: list[tuple[str, int, int]] = []
    for i, label in enumerate(labels):
        if label in (None, NONE):
            continue
        if out and out[-1][0] == label and out[-1][2] == i - 1:
            out[-1] = (label, out[-1][1], i)
        else:
            out.append((label, i, i))
    return out


def progress(rows: Sequence[dict], calls: Sequence[dict]) -> list[str]:
    """What the supervisor did that a user would notice: steps done, mistakes, the end."""
    t0 = calls[0]["t_ms"][-1]
    events = []
    for row, call in zip(rows, calls, strict=True):
        if row["event"] in (Event.STEP_DONE.value, Event.MISTAKE.value, Event.TASK_DONE.value):
            what = row["step"] if row["event"] != "mistake" else f"{row['mistake']} at {row['step']}"
            events.append(f"{(call['t_ms'][-1] - t0) / 1000:5.1f}s {row['event']}: {what}")
    return events


def analyse(session: Session, labels: dict[str, str], make_controller: Callable[[], Controller]) -> dict:
    model_out = [VlmOutput.model_validate(c["output"]) for c in session.calls]
    model_rows = replay(session.task, session.calls, model_out, make_controller())
    diverged = [
        c["call"]
        for c, r in zip(session.calls, model_rows, strict=True)
        if r["next_before"] != c["next_steps"]
    ]
    truth = effective_labels(session, labels)
    result: dict = {
        "id": session.id,
        "task": session.task.model_dump(mode="json"),
        "calls": session.calls,
        "labels": {k.split(":", 1)[1]: v for k, v in labels.items() if k.startswith(session.id + ":")},
        "truth": truth,
        "model": model_rows,
        "replay_diverged": diverged,
        "model_progress": progress(model_rows, session.calls),
    }
    labelled = [i for i, t in enumerate(truth) if t is not None]
    if not labelled:
        return result
    oracle_rows = replay(session.task, session.calls, oracle_outputs(truth), make_controller())
    confusion: Counter[tuple[str, str]] = Counter()
    for i in labelled:
        confusion[(truth[i], session.calls[i]["output"]["action"] or NONE)] += 1
    segs = segments(truth)
    missed = [
        (a, i, j)
        for a, i, j in segs
        if not any(session.calls[k]["output"]["action"] == a for k in range(i, j + 1))
    ]
    result |= {
        "oracle": oracle_rows,
        "oracle_progress": progress(oracle_rows, session.calls),
        "accuracy": sum(n for (t, p), n in confusion.items() if t == p) / len(labelled),
        "labelled": len(labelled),
        "confusion": [[t, p, n] for (t, p), n in sorted(confusion.items())],
        "segments": len(segs),
        "missed_segments": [[a, session.calls[i]["call"], session.calls[j]["call"]] for a, i, j in missed],
    }
    return result


def report(analysis: dict) -> str:
    calls = analysis["calls"]
    lines = [f"## session {analysis['id']} · {analysis['task']['id']} · {len(calls)} calls"]
    if analysis["replay_diverged"]:
        lines.append(
            f"⚠ the replay's next steps differ from the live run at calls {analysis['replay_diverged'][:10]} "
            "(another controller live, or a reset/skip): compare with care"
        )
    lines += ["", "Supervisor with the model's answers:"] + [
        f"  {e}" for e in analysis["model_progress"] or ["(nothing)"]
    ]
    if "accuracy" not in analysis:
        lines.append(
            "\nNo labels yet: label the run in the browser to split perception from controller errors."
        )
        return "\n".join(lines)
    lines += ["", "Supervisor with the labels (perfect perception):"]
    lines += [f"  {e}" for e in analysis["oracle_progress"] or ["(nothing)"]]
    lines += [
        "",
        f"Perception: {analysis['accuracy']:.0%} of {analysis['labelled']} labelled calls right; "
        f"{len(analysis['missed_segments'])} of {analysis['segments']} real actions never reported:",
    ]
    lines += [f"  missed {a} (calls {i}-{j})" for a, i, j in analysis["missed_segments"]]
    lines.append("Confusions (truth → model: calls):")
    lines += [f"  {t} → {p}: {n}" for t, p, n in analysis["confusion"] if t != p]
    return "\n".join(lines)


PAGE = Path(__file__).with_name("review.html")


class Review:
    def __init__(
        self, run_dir: Path, library: TaskLibrary, make_controller: Callable[[], Controller]
    ) -> None:
        self.run_dir = run_dir
        self.library = library
        self.make_controller = make_controller
        self.labels_path = run_dir / "labels.json"

    def labels(self) -> dict[str, str]:
        return json.loads(self.labels_path.read_text()) if self.labels_path.exists() else {}

    def set_label(self, key: str, value: str | None) -> None:
        """Labels are a closed set: `none` or one of the session's task actions, on a recorded call."""
        sessions = {s.id: s for s in load_sessions(self.run_dir, self.library)}
        sid, _, call = key.partition(":")
        session = sessions.get(sid)
        if session is None or not any(str(c["call"]) == call for c in session.calls):
            raise ValueError(f"no recorded call {key!r}")
        if value is not None and value != NONE and value not in session.task.actions:
            raise ValueError(f"label {value!r} is not an action of task {session.task.id!r}")
        labels = self.labels()
        if value is None:
            labels.pop(key, None)
        else:
            labels[key] = value
        self.labels_path.write_text(json.dumps(labels, indent=1, sort_keys=True))

    def data(self) -> dict:
        labels = self.labels()
        analyses = [
            analyse(s, labels, self.make_controller) for s in load_sessions(self.run_dir, self.library)
        ]
        return {"sessions": analyses, "reports": {a["id"]: report(a) for a in analyses}}


def serve(review: Review, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, body: bytes, kind: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _local(self) -> bool:
            """Only answer requests addressed to our own host (no DNS rebinding to the webcam frames)."""
            if self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}":
                return True
            self.send_error(403, "open the review at http://127.0.0.1:<port>/")
            return False

        def do_GET(self) -> None:
            if not self._local():
                return
            if self.path == "/":
                self._send(PAGE.read_bytes(), "text/html; charset=utf-8")
            elif self.path == "/data.json":
                self._send(json.dumps(review.data()).encode(), "application/json")
            elif self.path.startswith("/frames/"):
                path = review.run_dir / Path(unquote(self.path.removeprefix("/frames/"))).name  # no traversal
                if path.suffix != ".jpg" or not path.exists():
                    self.send_error(404)
                    return
                self._send(path.read_bytes(), "image/jpeg")
            else:
                self.send_error(404)

        def do_POST(self) -> None:
            if not self._local():
                return
            if self.path != "/labels":
                self.send_error(404)
                return
            origin = self.headers.get("Origin")
            if origin is not None and origin != f"http://127.0.0.1:{self.server.server_port}":
                self.send_error(403, "labels are only accepted from the review page")
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            try:
                review.set_label(body["key"], body["value"])
            except ValueError as error:
                self.send_error(400, str(error))
                return
            self._send(json.dumps(review.data()).encode(), "application/json")

        def log_message(self, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"Review at {url}  (Ctrl+C to stop; labels go to {review.labels_path})")
    webbrowser.open(url)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--report", action="store_true", help="print the text report and exit")
    parser.add_argument("--min-calls", type=int, default=10, help="report only sessions this long")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--tasks-dir", type=Path, default=REPO_ROOT / "tasks")
    args = parser.parse_args()
    review = Review(args.run_dir, TaskLibrary.load(args.tasks_dir), RulesController)
    if args.report:
        data = review.data()
        for analysis in data["sessions"]:
            if len(analysis["calls"]) >= args.min_calls:
                print(data["reports"][analysis["id"]], end="\n\n")
        return
    serve(review, args.port)


if __name__ == "__main__":
    main()
