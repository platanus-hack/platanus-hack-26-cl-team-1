# Contracts

The shared data shapes between the pieces, so the three workstreams (and their agents) can build in
parallel. **Source of truth: the pydantic models in [`contracts/`](../contracts/src/contracts/)**; this
page explains them. JSON Schemas are generated into [`contracts/schemas/`](../contracts/schemas/) (CI
fails if they're stale) for the web app and for model prompts.

**Changing a contract:** a decision entry in `agent-kb/decisions.md`, every consumer updated in the same
PR, `uv run python -m contracts.export` re-run. Additive optional fields are the cheap kind of change.

```
 Library (Alonso)          Simulator / webcam (Anaís)              Models (Cote)                    Voice (Alonso)
 ontology.json ──┐         frames ─────────────┐
 task.json ──────┼──▶ Task ──▶ automaton        ├──▶ VlmOutput → Observation ──▶ Decision ──▶ SayRequest ──▶ audio
                 │         Trajectory, ClipRecord ──▶ (training / eval)                │
                 └────────────── WebSocket protocol (browser ↔ server) ◀───────────────┘
```

| # | Contract | Module | Producer → consumer |
|---|---|---|---|
| 1 | Action ontology | `ontology.py` | Library → everyone |
| 2 | Task (recipe) + derived automaton | `task.py`, `automaton.py` | Library → simulator, models, UI |
| 3 | Perception output / observation | `perception.py` | M_VL → controller |
| 4 | Controller decision | `decision.py` | Controller → voice, UI |
| 5 | WebSocket protocol | `protocol.py` | Browser ↔ server |
| 6 | Trajectories and clip records | `dataset.py` | Simulator → training and eval |
| 7 | In-process interfaces: `Perception`, `Controller`, `Voice` (+ fakes) | `interfaces.py`, `fakes.py` | Session server ↔ each component |

All ids are `snake_case` (`^[a-z][a-z0-9_]*$`). Every model forbids unknown fields. Spanish only in
`*_es` fields and in text that is spoken; everything else English.

## 1. Action ontology

The global vocabulary for a **domain** (e.g. `hand_hygiene`, `sterile_gloving`): `objects` and
`actions`. An action is one atomic, *visible* thing: `verb(object, target)` with a `label_es` and a
`visual_cue` (what a camera sees; reused by the perception prompt and the video-generation prompt).

A task picks a subset. That subset is what "restricting the actions to the scenario" means: the VLM may
only answer with the task's actions, and the controller only predicts among them.

## 2. Task and its automaton

```jsonc
{
  "id": "hand_hygiene_basic", "version": 1, "domain": "hand_hygiene", "ontology_version": 1,
  "title_es": "…", "description": "…",
  "objects": ["faucet", "soap", "hands", "paper_towel"],
  "actions": ["wet_hands", "apply_soap", …, "touch_faucet_bare"],   // ⊂ ontology
  "steps": [
    {"id": "wet",  "action": "wet_hands",  "requires": [],      "title_es": "…", "instruction_es": "…", "completion_cue": "…"},
    {"id": "soap", "action": "apply_soap", "requires": ["wet"], …, "min_duration_s": null}
  ],
  "mistakes": [
    {"id": "bare_faucet", "kind": "wrong_action", "step": "close", "action": "touch_faucet_bare",
     "description": "…", "visual_cue": "…", "correction_es": "Ojo, …"}
  ]
}
```

- **The automaton is derived, not written.** Steps form a DAG through `requires` (listed in a valid
  order; no forward references, so no cycles). A state = the set of completed steps. Legal next = steps
  whose prerequisites are all done. Partial orders ("palms" and "backs" in any order) come for free.
- **Each step is completed by exactly one action**, and no two steps share an action.
- **Mistake kinds** (closed set): `out_of_order` and `repeated` are detected generically from the graph;
  `wrong_action` (an action the task contains only to recognize a mistake) and `incomplete` (right action,
  done badly / shorter than `min_duration_s`) need a `MistakeDef`. A `MistakeDef` also overrides the
  generic correction text for its step.
- `TaskAutomaton.apply(done, action)` returns `advance | mistake | task_done` with the mistake kind and
  definition. The simulator, the rule controller and the evaluation all use it, so "legal" means the same
  thing everywhere. A mistake never changes the state.
- `Task.check_against(ontology)` verifies every id exists. Claude-generated tasks must pass the model
  validation **and** this check before they enter `tasks/`.

## 3. Perception → controller

The VLM must answer exactly `VlmOutput` (pass `vlm_output_json_schema()` as structured output):

```json
{"action": "apply_soap", "confidence": 0.82, "quality": "ok", "objects": ["soap", "hands"], "note": "…"}
```

- `action: null` = nothing from the task is happening, or unsure. It must come with `quality: "unknown"`,
  and the supervisor stays silent on it.
- `quality: "bad"` = attempted but done wrongly (feeds `incomplete` and task mistakes).
- `parse_vlm_output(raw, task)` validates the shape *and* that the action and objects belong to the task.
  Anything invalid raises `InvalidVlmOutput` → treat as uncertain, never guess.

The server wraps it as an `Observation` (`seq`, `t_ms` of the last frame seen, `source`, `model`,
`latency_ms`) before handing it to the controller.

## 4. Controller → voice and UI

Both controllers (rules and learned) emit a `Decision`: `event` (`none | step_done | mistake |
mistake_fixed | reminder | task_done`), the `step`, `mistake_kind` / `mistake_id` (set exactly when the
event is a mistake), `statuses` for every step (`pending | active | done | mistake`), `next_steps`, and an
optional `say` (`text` in Spanish, `priority` `normal | urgent`). `event: none` never speaks. The voice
component owns anti-spam (≤1 clip per ~4 s, urgent first, no repeats within ~15 s, cancel when fixed).

## 5. WebSocket protocol (`/ws/session`, protocol 1)

Client → server (JSON): `hello {task_id, source: sim|webcam, debug, record}`, `skip_step`, `reset`,
`mute {on}`, `label {step, mistake_id}` (recording only).
Client → server (binary, per frame): `uint32 seq, uint32 t_ms` little-endian + JPEG.

Server → client (JSON): `ready {session_id, task}` (full task, so the UI draws the checklist),
`state {seq, statuses, next_steps}`, `issue {step, kind, mistake_id, text_es}`, `issue_clear {step}`,
`say {id, text, priority, audio}`, `cancel_say {id}`, `debug {seq, latency_ms, observation}` (also the
per-frame ack), `error {code, message}`.
Server → client (binary, per `say` with audio): `uint8 len(id), id` + `audio/mpeg` bytes. With
`audio: false` the browser may speak the text with `speechSynthesis`.

Helpers: `pack_frame/unpack_frame`, `pack_audio/unpack_audio`, `client_message_adapter`,
`server_message_adapter`. Same framing as the old Modo Armado (mp3 instead of WAV), so its browser code ports.

## 6. Simulator and datasets

- `Trajectory`: a symbolic run over a task (`seed`, `split`, `noise` parameters, `completed`), with events
  carrying ground truth (`true_action`, `step`, `mistake_kind`, `mistake_id`) and what simulated
  perception reported (`observed_action`, `observed_confidence`). Trains and tests the controller.
- `ClipRecord`: one clip (`runway | wan | recorded`) with its label (`action`, `step`, `is_correct`,
  `mistake_id`), `run_id`, `split`, `path` relative to the data root on the GPU server, and the generation
  `prompt`. Manifests are JSONL in git; the clips are not.
- **Splits are per run / recording session**, never per clip or frame of the same run.

## 7. Interfaces inside the server

The session server (Alonso) drives three components through `typing.Protocol`s, so any implementation
plugs in (fake, rules, learned model, API, local model):

```python
class Perception:   # Cote
    async def observe(self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]) -> Observation | None
class Controller:   # Cote; one instance per session
    def start(self, task: Task) -> Decision          # reset + greeting
    def decide(self, observation: Observation) -> Decision
    def tick(self, now_ms: int) -> Decision | None    # ~1/s; reminders when stuck
    def skip(self, now_ms: int) -> Decision           # "ya lo hice"
class Voice:        # Alonso
    async def synthesize(self, request: SayRequest) -> bytes | None   # mp3, or None = browser speaks
```

- The session owns timing and concurrency: ≤1 `observe` in flight, `tick` once per second of client time.
- `observe` never raises for a bad model answer (return an uncertain observation or `None`); it raises only
  for real failures, which the session reports as an `error` message.
- Anti-spam (drop, cancel, prioritize) is the session's voice queue, not `Voice`.
- **Fakes** (`contracts.fakes`): `ScriptedPerception.correct_run(task, every_ms, mistake=…)` replays a run on
  the client clock with no model; `SilentVoice` returns `None`. The server uses them by default
  (`SUP_PERCEPTION=scripted`, `SUP_VOICE=browser`), so the whole loop runs on a laptop.

## Example

[`contracts/examples/`](../contracts/examples/) holds a hand-washing ontology and task that exercise every
rule (partial order, three mistake kinds). It's a fixture, **not** the chosen demo scenario.
