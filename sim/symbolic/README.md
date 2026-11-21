# Symbolic simulator (`symsim`)

Generates `contracts.Trajectory` records from a task's automaton, to train and test the controller.

```bash
cd sim/symbolic && uv sync
uv run symsim --task ../../tasks/hand_hygiene/hand_hygiene_basic.json --n 3000 --noise mix --out runs.jsonl
```

- **True timeline** per run: a random valid topological order of the steps, step durations from
  `min_duration_s` (default 3 s, ×0.7–1.6), idle gaps (sometimes 8–25 s: the user is stuck), and 0–2 injected
  mistakes followed by the correction: `out_of_order` (a step whose prerequisites aren't done), `wrong_action`
  (the task's `MistakeDef` actions when they fit the state, else any task action that completes no step),
  `incomplete` (the right action, short and with quality `bad`; the same step is then redone) and `repeated`
  (a done step again). 10% of runs stop early (`completed: false`). Labels come from `TaskAutomaton.apply`.
- **Perception noise** (`symsim.noise`, levels `clean | low | medium | high`, recorded in `noise`): the report
  is of what happened up to `delay_ms` earlier (so ongoing actions are reported several times), then
  `drop` (missed), `confuse` (a similar action: same verb or object in the ontology), `spurious` (idle reported
  as an action), `uncertain` (null), `quality_miss` / `quality_false` on `observed_quality`.
- **Splits per run** (80/10/10), from the base seed and run index only: run `i` has the same timeline and split
  at every noise level, so test sets at different noise levels are comparable and never leak into train.
