# 2026-11-21 — perception-object-guard

- **Who:** alonso (+ agent)
- **Branch / PRs:** `fix/perception-object-guard`
- **Goal:** stop the live demo from completing `place_button` when only an empty breadboard is in view.

## Done
- Diagnosis workflow (4 lenses, a design pass, skeptics on each change). There are no observation logs, so the
  chain is reasoned from the code: the "Expected next … should be doing" prompt line, `action` decoded before
  `objects`, no check of the action against what was seen, and one observation completes a step (D-017).
- `prompt.py`: objects/note decoded first; SYSTEM rules say an action needs the object it acts on visible;
  each action line shows `[acts on: <object>]`; softer "Expected next". A derived "Base objects" line was tried
  and dropped: in aviation it listed the ignition key, which `start_engine` turns.
- `vlm.py`: `_require_object_seen` guard (→ uncertain + WARNING); INFO line for each answer. `ws.py`: INFO line
  for each decision. `deploy/demo_app.py`: logging configured so both reach `~/sup/logs/demo-server.log`.
- `robot_assembly` ontology: `connect_motor_wires` acts on `dc_motor` (target `motor_driver`). A review
  workflow showed the guard would otherwise reject correct motor-wiring answers in the default demo task. Weights
  are unaffected (they record task version, actions and steps).
- `aviation` ontology: `rotate` / `rotate_early` act on `attitude_indicator` (target `yoke`): the C172 page draws
  no yoke, so the guard would have rejected every rotation.
- Rebased on main after #34 (run recording): its VLM log line now also carries next steps, quality and objects,
  and `deploy/demo_app.py` configures logging so it reaches the box log. The decision is D-017 (D-016 was taken twice on main).
- Tests: guard (hand hygiene, the breadboard case, robot motor wiring, cockpit rotate and establish_climb),
  schema order with no field dropped, "acts on" in the prompt.

## Decisions
- D-017.

## Open / blocked
- Not measured on the real model: run `app.perception.bench --task led_flashlight` on an empty-breadboard
  photo and a button-placed photo (recall on the button must hold), and read the WARNING lines on the first
  live run.
- The learned controller marks steps done on all-null observations from its time prior (measured by the
  diagnosis: `button` at 1.5 s). Safe while the demo runs `SUP_CONTROLLER=rules`; needs an "armed" gate before
  learned mode is demoed.

## Next
- Learned-controller gate PR (Cote's area).
