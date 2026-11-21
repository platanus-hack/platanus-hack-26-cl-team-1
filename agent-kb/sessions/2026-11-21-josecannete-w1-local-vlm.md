# 2026-11-21 — w1-local-vlm

- **Who:** josecannete (+ agent, workspace W1)
- **Branch / PRs:** `josecannete/vlm-local-mac` (PR link in backlog)
- **Goal:** a light model to prototype perception on the Mac while the GPU box is unreachable over SSH.

## Done
- Ollama (Homebrew) + `qwen3-vl:2b-instruct` (1.9 GB) on an M1 with 8 GB; `VlmPerception` works unchanged
  against `http://localhost:11434/v1`. The JSON schema is respected, so every answer parsed.
- `app.perception.bench` on four public photos (Wikimedia Commons, kept out of the repo):
  - hand hygiene: 2.0–2.2 s per frame warm
  - robot task (longer prompt): 4.4–9.6 s warm
  - first call: 13–14 s
- `gpu/README.md` § Local on a Mac.

## Findings
- The 2B model is fine for plumbing, not for judging. In the robot task it labelled a hand-washing photo
  `mount_dc_motor` with confidence 0.95.
- Confidence is always ~0.95, and `objects` echoes the prompt's list.
- 8 GB swaps heavily (~10 GB of swap in use).

## Open / blocked
- SSH to the GPU box still refused; the 8B model on the 3090 remains the real target (D-012).

## Next
- Real frames of the robot kit (webcam) on the 8B once the box is reachable; compare against the 2B.
- Consider not trusting the model's confidence; e.g. require the same action on 2 consecutive calls.
