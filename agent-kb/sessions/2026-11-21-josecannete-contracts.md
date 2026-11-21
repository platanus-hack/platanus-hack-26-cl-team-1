# 2026-11-21 — contracts

- **Who:** josecannete (+ Claude)
- **Branch / PRs:** `josecannete/repo-state-run-v4`
- **Goal:** define the contracts between the pieces before anyone builds, and record ownership.

## Done
- `contracts/` uv package (pydantic v2): ontology, task + automaton derived from the step DAG, VLM output +
  observation + `parse_vlm_output`, controller decision, WebSocket messages + binary framing, trajectory and
  clip records. Example hand-washing ontology/task as a fixture (not the demo choice).
- 38 tests; JSON Schemas generated in `contracts/schemas/`; CI job `contracts` (ruff, pytest, schema
  freshness) added to `CI OK`.
- `docs/CONTRACTS.md` spec; ownership table in `docs/STACK.md`; owners on backlog items.

## Decisions
- D-008 (ownership), D-009 (contracts design).

## Open / blocked
- Demo direction set to physical assembly in robotics (a contact who assembles robots offered a testimonial and a
  pitch framing); exact task pending their input. VISION, decisions §2 and backlog updated.
- Ownership completed: session server → Alonso, web UI → Anaís (D-008). Voice is text-to-speech only (confirmed).
- Agent reviews still failing on the API key (see PR #12 run).

## Next
- Skeleton: `server/` and `web/` on top of `contracts/`, with CI jobs.
