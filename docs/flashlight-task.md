# Flashlight demo task: handoff to the task library

Status: **draft for the task library owner** (Alonso, `tasks/`). Nothing here is a `task.json` yet; it
collects what the team decided for the demo so the real task can be written (by hand or with the
generator) and validated. Written 2026-11-21.

## The demo

Someone builds a battery flashlight on a breadboard under an iPhone that points **straight down** at
the board, **hands in shot**. The supervisor page (`/supervisor`) streams that camera to the session
server; the models (video → text, controller) are fine-tuned on real videos of this same build. Midway
the builder **puts the LED in backwards on purpose**, and the supervisor has to warn them out loud.

## Kit (photos taken on the demo table)

- 2×AA battery holder (3 V) with red and black leads
- 220 Ω resistor (red-red-brown bands)
- 2-pin tactile push button
- half-size breadboard: rows 1–30, columns a–e and f–j, a + / − rail pair on each side
- one LED with a clear lens (color it lights in: to confirm)
- jumper wires

## Draft steps

Hole positions are **placeholders**: they must match how the team actually wires it on camera, since
the models are trained on that.

| # | Step (draft id) | What | Requires |
|---|---|---|---|
| 1 | `button` | Push button across the center gap, legs in rows 5 and 7 | — |
| 2 | `resistor` | 220 Ω resistor from row 7 to row 12 | `button` |
| 3 | `led` | LED long leg (+, anode) in row 12, short leg (−) in row 13 | `resistor` |
| 4 | `ground_wire` | Jumper from row 13 to the − rail | `led` |
| 5 | `power_wire` | Jumper from the + rail to row 5 | `button` |
| 6 | `battery` | Battery holder last: red lead to +, black lead to − | `ground_wire`, `power_wire` |
| 7 | `test` | Press the button: the LED lights | `battery` |

## Mistakes

- **LED backwards (the demo mistake).** From above a reversed LED looks almost the same as a correct
  one: once it's in the board the longer leg and the flat side are hidden. The **visible** cue is the
  test: the button is pressed and the LED stays dark. So the task needs the `test` step, and a
  `wrong_action` mistake with its own action (e.g. `insert_led_reversed`) whose `visual_cue` says
  "button pressed, LED stays off" (plus "flat side / short leg toward the resistor" when visible).
  Its `correction_es` should tell them to turn the LED around.
- **Battery before the wiring is finished.** Caught generically as `out_of_order` from the step graph.

## Open points

- Exact holes and the LED color (ask the team for a photo of the finished circuit from the iPhone).
- Domain and ontology: proposal `tasks/breadboard_circuits/` with objects (breadboard, battery holder,
  resistor, LED, push button, jumper wire) and verbs (insert, connect, press).
- The learned controller needs weights per task: `make controller TASK=tasks/<domain>/<task>.json`
  before running with `SUP_CONTROLLER=learned` (the server refuses to start without them).
