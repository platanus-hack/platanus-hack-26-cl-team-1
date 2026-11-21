# 2026-11-21 — w1-perception

- **Who:** josecannete (+ agent, workspace W1)
- **Branch / PRs:** `josecannete/gufg0` → https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/21
- **Goal:** replace the scripted perception with Qwen3-VL-8B FP8 on vLLM (3090) behind `Perception`.

## Done
- `server/app/perception/vlm.py`: `VlmPerception` + `OpenAICompleter` (async `openai` SDK, `max_retries=0`).
  ≤1 call in flight, `SUP_VLM_MIN_INTERVAL_MS` (1500) between calls, newest frame + one ~`SUP_VLM_SPAN_MS`
  older, downscaled to `SUP_VLM_MAX_SIDE_PX`. Invalid/contradictory answers → `action=None, quality=unknown`
  with the reason in `note`; transport errors and undecodable frames raise.
- `server/app/perception/prompt.py`: system rules + task context (actions with `visual_cue`/`label_es`,
  objects, next steps with `completion_cue`, mistakes) and the contract schema narrowed to the task's
  actions/objects for guided decoding. Separate module so the fine-tuning dataset can reuse it.
- `server/app/perception/bench.py`: judge JPEGs through `VlmPerception`, print observations and p50/p95.
- Settings `SUP_VLM_*`, `PerceptionMode.VLM` (startup fails without `SUP_VLM_BASE_URL`), factory wiring; the
  ontology is read from `tasks/<domain>/ontology.json` (the library doesn't expose it).
- `gpu/`: `vllm.sh`, `up.sh`, `deploy.sh`, `sup-vllm` / `sup-tunnel` units, README. The tunnel goes straight
  to vLLM, protected by `--api-key`; `up.sh` checks that unauthenticated calls get 401.
- Tests (fake completer, no network): prompt contents, schema narrowing, valid → observation, six kinds of
  bad answers → uncertain, server failure raises, rate limit, one in flight, frame picking, downscaling,
  and a WebSocket session running on the VLM path.

## Decisions
- Perception stack and tunnel layout (→ decisions.md D-011).

## Open / blocked
- **`ssh 172.16.0.204` → "Connection refused" on port 22** (the host answers ping). GPU part not run:
  no tunnel URL, no measured latency yet. Needs someone with physical/console access to check sshd.
- The library could expose `ontology(domain)` so perception doesn't re-read the file (Alonso's area).

## Next
- Once SSH works: `gpu/deploy.sh`, `app.perception.bench` on real frames (p50/p95 into a PR), webcam end to end.
- Tune the prompt on real frames; consider sending frames only on change (motion) to save GPU.
