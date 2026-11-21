# 2026-11-21 — library-voice

- **Who:** alonso (+ Claude)
- **Branch / PRs:** `feat/task-library-robot-assembly` (https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/17), `feat/voice-elevenlabs`
- **Goal:** Alonso's block 1–2 items: robot assembly ontology, Claude task generator + first task, ElevenLabs voice with anti-spam.

## Done
- `tasks/robot_assembly/ontology.json` (22 objects, 25 actions incl. visible wrong-action variants) and
  `servo_scout_robot.json` (10 steps, battery last, 4 mistakes).
- `server/app/library/generate.py`: Claude structured output, ids restricted to the ontology's enums, validated with
  `Task` + `check_against`, errors fed back to Claude, raises after 3 attempts. The loader now also checks that a task
  lists every object its actions use (caught a missing `chassis`).
- `server/app/voice/elevenlabs.py` (Flash v2.5, mp3, `language_code=es`; a failed call logs an error and returns
  `None` → the browser speaks the line) and `server/app/voice/queue.py` (port of `speaker.py` on the client clock:
  4 s gap and wait for the previous line, urgent jumps, newest waiting line wins, no repeat within 15 s,
  `cancel_say` when a mistake is fixed or on reset). Web: `web/src/session/voice.ts` plays one line at a time.

## Decisions
- None new. Voice queue runs on the client clock (frames' `t_ms`), so it pauses with the video and tests need no sleeps.

## Open / blocked
- No `ANTHROPIC_API_KEY` or `ELEVENLABS_API_KEY` on this machine: the generator and ElevenLabs were only tested with
  stubs. The web voice player wasn't tried in a real browser.
- Spanish voice not picked (`SUP_ELEVENLABS_VOICE_ID` is required, no default).

## Next
- With keys: generate the demo task live, pick the voice, run `make dev` with `SUP_VOICE=elevenlabs`.
