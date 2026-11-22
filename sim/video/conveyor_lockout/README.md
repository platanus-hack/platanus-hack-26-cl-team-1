# Generated clips: lockout before clearing a conveyor jam

A video model as the task simulator: one start image, then one clip per action, all from the same keyframe so
the scene stays identical. The task is `tasks/industrial_safety/conveyor_lockout.json`.

| File | What |
|---|---|
| `clips/c_lock.mp4` | Correct: the worker hooks the red padlock and the tag on the isolation switch's red handle, then steps back |
| `clips/c_mistake_hand_in.mp4` | Mistake `hand_in_unlocked`: he pockets the padlock, walks to the belt and reaches for the jammed rock |
| `cases/` | 9 labelled frame pairs cut from both clips, for `app.perception.cases` |
| `prompts.md` | The image and video prompts |

Both clips start with the belt stopped and the switch already OFF, so a session that plays them should mark
the first two steps done first (`skip_step` twice, the "ya lo hice" message). Otherwise the supervisor warns
"todavía no" twice before the padlock.

## How they were made

ElevenLabs app (Image & Video), Veo 3.1 Fast, 8 s, 1280×720, 24 fps; start frame from an image model. The
Image & Video **API** needs a Pro plan (a Creator key gets `402 paid_plan_required`); the app works on Creator.
These two clips plus their images cost about half of a Creator plan's monthly credits.

Known flaws: Veo added a fake security-camera timestamp (it jumps) and a second camera on a tripod in the scene.
Say "no timestamp, no on-screen text, no camera in the scene" in the next prompts.

## Score them

```bash
cd server && SUP_VLM_BASE_URL=http://localhost:8001/v1 \
  uv run python -m app.perception.cases ../sim/video/conveyor_lockout/cases --repeat 3
```

With the completion checks of D-020 (`SUP_VLM_CHECK_TASKS=conveyor_lockout`, once that PR is in), the padlock is
ticked only once it hangs from the handle, and "¡Alto! No metas las manos…" fires on the mistake clip 6/6.
Without them, the 8B ticks the padlock while the worker only holds or pockets it. Numbers: the D-020 PR.

The cases label the windows where the padlock is being put on as `apply_padlock`. With the checks on they stay
quiet on purpose: the step is ticked a moment later, when it hangs. So the table's pass count understates it;
read the "controller would" column.
