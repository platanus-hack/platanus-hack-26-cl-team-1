# 2026-11-22 — optimizer-investigation

- **Who:** josecannete (+ Claude, a multi-agent workflow)
- **Branch / PRs:** `josecannete/imfl0` (this log only; no code change)
- **Goal:** find out whether an optimizer can search the measures (alerts, preparation, street links,
  firebreaks, fuel belts, hardening) that most reduce the households whose way out is cut, for a given setting.

## Done
- A shared Node harness reproduces the worker exactly: baseline 4,753 households cut off (13,785 people). One
  fire + evac run takes about 80–150 ms on an M1. Five weather members (wind ±20 %, dir ±10°) for robustness,
  ten more held out.
- Four families probed by separate agents, then checked (behaviour fully, links and fuel partly, firebreaks
  and the cross-family run by hand after a usage limit):
  - **Alert / behaviour:** every lever moves the count in one direction only, so there is nothing to search;
    show curves and exchange rates. A geofenced alert (fire within 2 km of the home, 90 % reach) plus a
    5-minute preparation saves 3,461 (73 %), 73–88 % on every member and 73–86 % under every model knob.
  - **Street links:** an exact incremental evaluator (0.012 ms per candidate, matches simulateEvac to 1e-11)
    makes a greedy over 13k candidates take 1–8 s. The effect is small: 10 links save 176–284 (4–6 %).
    Closing streets can never help in this engine.
  - **Linear firebreaks:** they only work 1.3–3.4 km from the assumed Las Tablas ignition, by delaying the
    western front. 9.6 km save 1,935 on the real weather but 2 with 20 % less wind, 95–184 if the ignition
    moves 1 km, and 0–1 % with spotting at 15–20 m per km/h. Not worth a stand-alone optimizer.
  - **Fuel by tiles:** greedy with re-evaluation is essential (at 100 ha it finds 1,964, against 515 from
    ranking tiles one by one). The single-weather optimum is fragile, while a uniform 200 m belt around
    inhabited land (10,477 ha) is robust: 1,313 real, at least 382 on every member, 20–52 % under every knob.
  - **Cross-family greedy:** belt → firebreaks → plantation conversion → hardening → links takes 4,753 to
    1,430 (−70 %); adding the geofenced alert takes it to 214. Links add to everything; fuel, firebreaks
    and the alert overlap (0.70–0.87 of the sum).
- Full report, scripts, masks and logs: `.context/optimizer/` in this workspace (gitignored, not in the
  repo). A literature and cost scan covers FlamMap TOM, DPV / Cell2Fire, CVaR firebreaks, WUIVAC triggers,
  Chilean cortafuego plans and the Ley de Incendios status.

- **Planning (proactive) version, at the team's request:** measures chosen before any fire, over an ensemble of
  plausible fires (240 ignitions in wildland 400 m-3 km from inhabited land, never within 2 km of the 2 Feb
  ignitions, all under 2 Feb's weather), tested on 80 held-out fires and then on 2 Feb. An independent check
  reproduced every number; corrected reading:
  - Belt tiles (1,000 ha) ranked on 30-160 sampled fires: 23-25 % on held-out fires, about 2.5-3.5x random tiles. On
    2 Feb, no better than random tiles (real member 0.0-0.2 %). Only the belt everywhere (10,477 ha) helps on 2 Feb:
    27.6 % on the real member.
  - Community programme in 20,000 households, sectors ranked on sampled fires: on held-out fires 5-6 %, close to random
    (median 3.2 %, max 5.0 % over 30 draws). On 2 Feb 15-20 % (real member 21-25 %), against a median of 2.7 % and a
    max of 11.6 % for random sectors. Why it transfers to 2 Feb is not established.
  - A plan tuned to 2 Feb saves 0 % on other fires (partly by construction).
  - Scripts: `proactive.ts`, `proactive2.ts`; check logs `zz-verify-proactive-*.log`.

## Decisions
- None recorded. Proposal (not decided): if the app gets an optimizer, it optimises over a weather ensemble,
  shows the minimum next to the mean, and covers links and fuel tiles only; alerts get curves instead.

## Open / blocked
- No number from this investigation is pitch-ready until its script is in the repo ("measure what you claim").
- The model is ember-dominated: the baseline is 731 / 4,753 / 24,622 at 15 / 25 / 35 m per km/h of spotting.
- The fuel agent's first 200 m belt included a belt around a built-up road corridor near the ignition
  (28 cells, 1 building). Fixed to inhabited land: 2,497 → 1,313 on the real weather.

## Next
- Planning optimizer in the app: bake the ensemble ranking offline (`plan.json`), then budget sliders in ha and
  households that highlight the tiles and sectors and apply them to the current scenario.
- Cheapest in-app win: an alert mode "por cercanía del fuego" (geofenced) mapped to `cueShare 1,
  cueRadiusM R`, which is exact for full reach.
- Links optimizer in the worker: port `links-core.ts` into `src/engine/evac` with a test against simulateEvac.
