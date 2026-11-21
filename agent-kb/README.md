# agent-kb

Working memory for agents (and humans) on this repo: what was done, what is pending, what was decided
and why. Plain Markdown, committed with the code it describes. Several people and agents work in
parallel, so files are split to avoid merge conflicts.

| File | What | Write rule |
| --- | --- | --- |
| [backlog.md](backlog.md) | Pending work: Now / Next / Later / Done, with an owner per item | Edit freely; move finished items to Done with the PR link |
| [decisions.md](decisions.md) | §1 in force, §2 open, §3 superseded (`D-NNN`) | Never delete from §3; check §1 and §3 before re-deciding anything |
| [sessions/](sessions/) | One log per working session: `YYYY-MM-DD-<handle>-<slug>.md` | **Append-only.** Never edit someone else's or a past session, except a sensitivity scrub (see Rules) |

## Session protocol

**Start**
1. Read `backlog.md` (Now) and the 3 newest files in `sessions/`.
2. Check `decisions.md` §1 and §3 before proposing anything that sounds like a decision. If a request
   conflicts with a decision in force, quote it and ask why before changing it.

**End** (before the last commit of the session)
1. Add `sessions/YYYY-MM-DD-<handle>-<slug>.md` from the template below. `<handle>`: the local part of
   `git config user.email`, or your GitHub handle.
2. Update `backlog.md`; record any decision in `decisions.md` (next free `D-NNN`; if two PRs collide on a
   number, the later one renumbers).
3. Commit the agent-kb changes with the work (`docs(agent-kb): …`).

## Session template

```markdown
# YYYY-MM-DD — <slug>

- **Who:** <handle> (+ agent)
- **Branch / PRs:** …
- **Goal:** one line.

## Done
- …

## Decisions
- … (→ decisions.md D-NNN)

## Open / blocked
- …

## Next
- …
```

## Rules

- ISO 8601 dates, times in America/Santiago. Bullets over prose. Link PRs with full URLs.
- No secrets or tokens. Write about systems and decisions, not about people.
- **This repo is public.** Don't name or quote private repos or other private sources; say "a private repo".
  Removing such text from a past session or decision is the one allowed edit to them (a sensitivity scrub).
