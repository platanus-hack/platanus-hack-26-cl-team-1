# Work plan (2026-11-21, from ~13:15)

How the team and its agents work in parallel until the deadline: **everything on `main` by Sun 2026-11-22
05:30 (America/Santiago)**. Owners and folders: `docs/STACK.md` § Ownership. Backlog: `agent-kb/backlog.md`.

_Status as of 2026-11-21 16:55._

## Rules for parallel work

- **One agent workspace per work item**, on its own branch, touching only its folders. Small PRs straight
  to `main`; draft until ready; both agent reviews addressed.
- **Contracts (`contracts/`) change only through a dedicated PR** with a decision entry (`make schemas`).
- **Before starting an item, check the table and open PRs** (`gh pr list`): if someone already has it,
  don't start a second agent on it. Update the Status column when you start or finish one. Cote's machine
  runs W1 and W2; Alonso runs A1/A2 from his own agent.
- The 3090 refuses SSH; the GPU work runs on the RTX 5090 box (D-014). Read `gpu/README.md` § RTX 5090.
- Missing access (SSH, API keys, photos) never blocks the whole item: build against fakes/mocks, then stop
  and ask a human for the live part.

## Work items

| # | Item | Owner | Folders | Status |
|---|---|---|---|---|
| **W1** | GPU + `VlmPerception` (Qwen3-VL via vLLM) | Cote | `gpu/`, `server/app/perception/` | Perception merged (#21). 3090 refuses SSH; moved to an RTX 5090 over an SSH forward (#27, D-014): 8B ~0.4 s/frame. Fixing a review finding in `up-5090.sh` |
| **W2** | Symbolic simulator + learned controller + rules-vs-learned eval | Cote | `sim/symbolic/`, `training/controller/`, `server/app/controller/` | **Done** (#18, #23, #25): `training/results/controller.md`, `SUP_CONTROLLER=learned` |
| **A1** | Robotics ontology, first demo task, Claude task generator | Alonso | `tasks/`, `server/app/library/` | **Done** (#17, #24): `servo_scout_robot`, generator ran live. #19 (duplicate draft) has an Arduino task to port or close |
| A2 | ElevenLabs `Voice` + anti-spam queue in the session | Alonso | `server/app/voice/`, `server/app/session/` | **Code done** (#22); needs the key + a voice heard end to end |
| A3 | Deploy: static web + public path to the GPU server, `deploy-url` | Alonso | `deploy/`, `render.yaml` | not started; the 5090 is only reachable by SSH forward today |
| N1 | Real web UI (port the old Modo Armado views, clip picker, debug overlay) | Anaís | `web/` | **not started** (critical for the demo); confirm owner |
| N2 | Clips per (step, correct / mistake) + `ClipRecord` manifest: real recordings first | Anaís | `sim/video/` | not started; needs the kit + camera |
| E1 | Label clips (Gemini/Claude as teacher); VLM base vs fine-tuned | Cote | `training/vlm/` | after N2's recordings; training on the 5090 |
| H | Confirm the demo task; kit + fixed camera setup; testimonial with consent; pitch; backup video; rehearsals | Team | — | **overdue**: demo task (default `servo_scout_robot`) + kit were due ~14:00 |

Changes vs. D-008: the symbolic simulator moved from Anaís to Cote (it only feeds the controller), and
deploy goes to Alonso (he ran Render and the GPU services before).

## Checkpoints

| Time | Checkpoint |
|---|---|
| ~14:00 | Demo task chosen (from A1's candidates) and the kit on the table |
| 15:30 | Each item works behind its interface: real VLM (W1), trajectories + first controller (W2), tasks + generator (A1) |
| 18:00 | **Real end-to-end loop with a webcam on the demo task** (never cut) |
| 22:00 | Clips + trajectories ready; VLM training window opens (vLLM stopped on the 3090) |
| 01:00 | Before/after numbers: controller (rules vs learned), VLM (base vs fine-tuned) if it fits |
| 03:00 | Deployed (A3), 3 rehearsals, backup video |
| 05:30 | Everything on `main`, hackathon files filled |

## GPU schedule (one RTX 3090)

vLLM up all day; the controller trains on CPU any time; VLM fine-tuning only from ~22:00 with vLLM
stopped; local video generation (if used) only in gaps, never during the demo window.

## Video generation (N2): Runway is not guaranteed

No Runway key yet, and it may not come. Fallbacks in order:
1. **Real recordings** of the demo task on our setup (correct runs + each mistake), labeled with
   `ClipRecord`. Always needed anyway for the eval split.
2. **Local open video generation** on the 3090 (Wan 2.2 TI2V-5B / LTX) from photos of the real parts, in
   GPU gaps.
3. Runway Gen-4.5 / Aleph if a key arrives.
The symbolic simulator (W2) doesn't depend on any of this.

## Keys still missing

ElevenLabs (A2; until then the browser speaks), Runway (N2; see above), Anthropic API key for the task
generator's live run (A1; the review bot uses a separate OAuth token).
