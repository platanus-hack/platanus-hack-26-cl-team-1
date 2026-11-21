# Learned controller (`training/controller`)

A tiny GRU (one layer, 64 units) trained from scratch on symbolic-simulator runs (`sim/symbolic`), one model
per task. Inputs per observation: the perception output (action one-hot, confidence, quality), time since the
previous observation, and whether the action repeats the previous report. Outputs: P(step done by now) per
step and P(mistake kind | none) now. The controller (`server/app/controller/learned.py`) only marks a step done
when it is legal next and attributes mistakes through the automaton, so it emits the same `Decision`s as the
rules. The server runs a numpy forward pass on the exported `weights/<task_id>.npz`: **no torch in `server/`**.

One command per task (CPU, about a minute), then the comparison:

```bash
cd training/controller && uv sync
uv run python -m ctrl.train --task ../../tasks/robot_assembly/servo_scout_robot.json
uv run python -m ctrl.evaluate --task ../../tasks/hand_hygiene/hand_hygiene_basic.json \
    --task ../../tasks/robot_assembly/servo_scout_robot.json   # → training/results/controller.md
```

(or `make controller TASK=tasks/<domain>/<task>.json`, which trains it and regenerates the results for every task.)

`train` simulates 6000 runs (noise levels mixed, split per run), trains on `train`, picks the mistake
threshold on `val` (medium noise) and exports. `evaluate` replays the `test` runs (same base seed, so their
timelines never appear in training) at each noise level through `RulesController` and `LearnedController`.
Run it in the server: `SUP_CONTROLLER=learned make dev` (every task in the library needs weights; the server
refuses to start otherwise). Retrain whenever a task's steps or actions change: the weights record the task
version, actions and steps, and the server refuses mismatched weights.

Tests (`uv run pytest`) need torch and are not in CI; the server's CI tests run the committed weights.
