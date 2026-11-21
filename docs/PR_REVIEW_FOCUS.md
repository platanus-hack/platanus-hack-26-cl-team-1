# PR review focus

Guide for adversarial review of pull requests in this repo. The Haiku and Sonnet review agents in
`.github/workflows/code-review.yml` read the copy on the **base branch**, and humans can use it too. It
complements [CLAUDE.md](../CLAUDE.md) (conventions, engineering practices) and
[agent-kb/decisions.md](../agent-kb/decisions.md) (what is already decided).

Context: a hackathon with a hard deadline (Sun 2026-11-22 05:30). Speed matters; a review that blocks on
taste costs more than it saves. Block on things that break the demo, the contracts, the numbers in the
pitch, or security.

## Stance

- **Assume the change is wrong until the code shows otherwise.** Look for the input, state or ordering
  that breaks it. A review that only confirms the description adds nothing.
- **Every finding needs a concrete failure.** Name the inputs or state and the wrong result. If you
  can't, drop the finding.
- **Verify before reporting.** Read the surrounding code, callers and tests. A finding that a look at
  the next file would disprove costs the author more than a missed nit.
- **Reporting nothing is a valid result.** Don't pad a review to look thorough.

## Scope

- **Static read.** CI owns lint, tests and builds; don't report what those gates catch. Do report what
  they can't, such as a test that passes without pinning anything.
- **Review the diff and what it touches.** Pre-existing problems count only if the change makes them
  worse or depends on them.
- **Check decisions first.** If the change contradicts a decision in force in `agent-kb/decisions.md`
  without superseding it, that is a finding.

## Severity

A `blocking` finding fails that reviewer's check. Choose by what happens if the change ships exactly as
it is; use `non_blocking` when unsure.

- **`blocking`:** wrong behavior someone would hit (in the demo loop especially), a broken shared
  contract, a security problem (secret exposure, unsafe workflow), a metric computed wrongly, or a
  weakened gate.
- **`non_blocking`:** a real improvement the change can ship without, including stronger tests for
  behavior you have no evidence is wrong. Style preferences no rule here backs are not findings.

## The questions that carry most of the value

1. **Does the code do what it claims?** Compare it against the PR title and body. Treat numbers in the
   description as unverified.
2. **Should this code exist?** Check existing modules, the libraries already in use, and the old project
   (`docs/LEGACY.md`, commit `2e9da7c`) before accepting a new helper, type or dependency.
3. **What else does it touch?** The other side of a contract, shared state, the WebSocket protocol, CI.
4. **Do the tests pin the behavior?** Mentally delete the guard or change the value. If no test fails,
   the test is decoration.

## Pitfalls in this repo

### Contracts

- The **action ontology**, **`task.json`** and the **perception → controller observation** are shared
  contracts. A change on one side without the other (server models, web types, task files, prompts)
  is blocking. So is a contract change without a decision entry.
- Model outputs (VLM JSON, Claude-generated tasks) are **untrusted input**: they must be parsed and
  validated where they enter. Code that indexes into them unchecked, or trusts an action id that isn't
  in the task's legal set, is a finding.

### Correctness

- **Silent fallbacks.** The most common finding: bare `except`, `except Exception: pass`, `.get(k, default)`
  hiding a missing required field, `?? default` / `|| default` in TypeScript, clamping, "safer" defaults.
  Uncertainty from a model must produce *silence from the supervisor*, not a guessed action; a broken
  pipeline must fail loudly.
- **Closed sets as strings.** Actions, step states, mistake types belong in enums / `Literal` / TS unions.
- **Async and real time.** Blocking calls inside async handlers (sync HTTP, model inference, file I/O on
  the event loop), unbounded queues, more than one VLM call in flight, WebSocket reconnects that lose
  the current step, audio clips that pile up.

### ML and evaluation

- **Leakage.** Train/eval splits must be by run / session / scenario, never by frame. Frames from the
  same clip on both sides is blocking.
- **Numbers for the pitch** must come from a script in the repo, run on the eval split. A hardcoded or
  hand-edited metric is blocking.
- Masking the controller's output to the task's legal actions must happen in inference *and* in the
  loss/eval, or the comparison is unfair.

### Security and secrets

- No API keys (Anthropic, ElevenLabs, Runway) in the web bundle, in the repo, in logs, in fixtures or
  in `agent-kb/`. Keys stay server-side.
- **Workflow safety.** Least-privilege `permissions`; no `${{ }}` interpolating untrusted text into
  `run:`; no `pull_request_target` job that executes PR code. Edits to `.github/`, `scripts/ci/` or this
  document are high-risk: a PR that weakens a gate passes that gate.

### Process

- Conventional-commit PR titles. Past ~500 LOC or mixing unrelated concerns: ask for a split.
- `agent-kb/sessions/` is append-only: editing someone else's or a past log is a finding. Decisions move
  to §3, never get deleted.
- A flag, parameter or field with no caller is unlanded code.

## Tone

Explain the failure, then hedge the suggestion: "why?" before "do Y instead", direct only on clear
errors. Name what blocks and what is optional.

## Keeping this document current

Add a rule when the same finding keeps coming up or a review misses a real bug. Remove one when tooling
starts enforcing it. Changes go through their own PR.
