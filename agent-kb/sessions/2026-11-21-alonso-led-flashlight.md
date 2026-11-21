# 2026-11-21 — led-flashlight

- **Who:** alonso (+ agent)
- **Branch / PRs:** `feat/task-led-flashlight`
- **Goal:** add a breadboard flashlight workflow (LED, 220 Ω resistor, push button, power source, jumper wires) to the task library.

## Done
- New domain `tasks/circuit_assembly/` with `ontology.json` v1: 6 objects (breadboard, LED, resistor, push button,
  jumper wire, AA battery pack) and 11 camera-visible actions. Each typical mistake (LED reversed, resistor with
  both legs in one row, button not straddling the gap, battery reversed) is its own action so it can back a
  `wrong_action`. Kept apart from `robot_assembly`: extending that ontology would bump its version and force a
  regenerate + retrain of `servo_scout_robot`.
- `led_flashlight.json` generated with `app.library.generate` (claude-opus-5-5 through the proxy, valid on the
  first try): 7 steps (button → resistor → LED, + rail wire, LED-to-ground wire, battery last, press and hold the
  button ≥ 2 s), 5 mistakes. Hand edit: the battery step's `requires` trimmed to its direct prerequisites.
- Controller weights `training/controller/weights/led_flashlight.npz` (`make controller`), and the results table
  regenerated. Learned vs rules shows the same trade-off as the other tasks (fewer false alarms, lower mistake recall).
- Tests: the repo task ids live in one constant; the missing-weights test matches the error text, not the
  first task's id (the new domain sorts first).

## Decisions
- None new. The power source is an AA battery pack (2–4 AA, about 3–6 V, so a 220 Ω resistor keeps the LED
  current safe). A 9 V battery would push it past 20 mA.

## Open / blocked
- No real webcam run yet. The visual cues for the breadboard rows (which row a leg is in) are subtle for a
  single frame; check them with the VLM on the 5090 before choosing this as the demo task.

## Next
- Team picks the demo task (backlog Now).
