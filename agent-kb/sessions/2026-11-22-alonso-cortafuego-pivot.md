# 2026-11-22 — cortafuego-pivot

- **Who:** alonso (+ agent)
- **Branch / PRs:** `feat/cortafuego` (replaces the whole tree)
- **Goal:** drop Ojo and ship an initial build of Cortafuego, a wildfire + evacuation scenario simulator.

## Done
- Pivot research (Sat 22:30–23:20): past Platanus winners, the 47 other Santiago repos, Bogotá's Simulations
  track, simulation startups and Chilean open data. The Santiago Simulations track is mostly agent/what-if
  simulators on maps of Chile; nobody simulates physical phenomena. Five finalists were red-teamed (tsunami,
  wildfire, crowd evacuation, tangible wind/sun table, LLM-designed towers on a shake table) plus a
  drug-interaction idea; the team picked the wildfire (D-019).
- Removed every Ojo folder (`contracts`, `server`, `sim`, `training`, `web`, `gpu`, `deploy`, `tasks`, old docs)
  and `cd-demo.yml`; CI now runs actionlint, the CI tooling tests, ruff on `pipeline/` and the web job.
- `pipeline/` bakes `web/public/data/` (14 MB) on a 464 × 529 grid of 60 m cells: Copernicus GLO-30, ESA
  WorldCover 2021, 321,533 Overture buildings, an OSM street graph (55k nodes, 71k edges), ERA5 weather via
  Open-Meteo, 1,122 NASA FIRMS detections, a Sentinel-2 dNBR scar (9,467 ha) and two approximate ignitions.
- `web/src/engine/fire/`: McArthur Mk5 / CSIRO grassland ROS, slope + wind vector, elliptical spread,
  16-neighbour minimum-travel-time propagation with anchors, gated ember spotting; 30–130 ms per run.
- `web/src/engine/evac/`: latest-departure label-setting search per mode on the street graph, lognormal
  preparation, per-household risk, flow per street, risk-vs-alert curve; 60–100 ms per run.
- `web/src/ui`, `worker`, `data`: MapLibre map (OpenFreeMap + AWS terrain, 3D, offline hillshade fallback),
  clock and playback, controls for weather (real ERA5 with adjustments, or constant), ignitions, spotting,
  firebreak drawing, alert time, preparation, foot share, closing streets, emergency links; results,
  baseline deltas, validation numbers.
- Calibration (`pnpm validate`): spotting raised to 25 m per km/h so the western front reaches Villa
  Independencia around 19:00 with the unmodified ERA5 wind; built-up cells spread slower and throw no embers;
  the simulation stops at midnight (no suppression in the model). Dice vs the scar at 00:00: 0.571;
  203 of 237 FIRMS detections of 2 Feb already reached by the model at detection time. In-sample.

## Decisions
- D-019: pivot to Cortafuego; D-001, D-005, D-008 to D-018 moved to §3.
- D-020: agent reviewers removed (the #48 diff was over GitHub's 300-file limit); PRs merge on `CI OK`.

## Open / next
- The model reaches ~21k buildings by midnight, but only ~1.9k of the 6,505 inside the real scar: where it
  burns inside the city is the weakest part. The trapped-households count inherits that.
- Public deploy host (decisions.md §2); `deploy-url` is still empty.

## Cleanup after the pivot (2026-11-22 ~01:20)

All Ojo / Circuito Vivo PRs were closed and every branch except `main` and `feat/cortafuego` was deleted, at the
team's request. To restore a branch: `git push origin <sha>:refs/heads/<branch>` (PR heads also stay reachable
on GitHub as `refs/pull/<n>/head`).

**Closed PRs:** #8 `feat/assembly-f10`, #19 `josecannete/ra428`, #32 `docs/flashlight-task-handoff`, #38 `fix/learned-controller-armed-gate`, #39 `fix/perception-object-guard`, #43 `docs/submission`, #46 `josecannete/water-cues-confirm`, #47 `josecannete/flight-simulation-brainstorming`, #49 `josecannete/lockout-task`, #50 `josecannete/lockout-plan`.

**Deleted remote branches (full head SHA):**

- `ci/agent-review` 667893ff97853f4084668e1e1286ee5fcf225da5
- `claude/cockpit-dataset` c7de8f3aa180cd138e75a7fc6c471a14640be6da
- `claude/cockpit-legibility` 8eabff16890bb83a3091ceead200126e46fe4b6f
- `claude/no-infer-defined-mistakes` bb5e6ee180c9f08f500413cacaaa6f3f71f09ad5
- `claude/recording-clock` 0030042e3934a839d10125d84c1a638c53e32883
- `docs/flashlight-task-handoff` 9121ada88af3c1fad9d2df4ce2c88c4c9f1efc9c
- `docs/status-refresh` 7854a693e481f89161fd6cbf0d835a30d2a2e60a
- `docs/submission` 761397ad7238463cb56e59cd70acdc00bb1c17ae
- `docs/work-plan` b34421742b1228f3b1948a8968e9ab7098c10390
- `feat/assembly-f0` 2e03631c3164982afc0422dfaea9ef6978f04f92
- `feat/assembly-f1` b4d3accd8a2d4596e20a887fd35242607455487c
- `feat/assembly-f10` fc139b82d88d185ace1160dfcd468c562f5c78b7
- `feat/assembly-f2` 2ac9dd234163041e5ed992232270746172aa27bd
- `feat/assembly-f3` 2780a57387d9e2017cf91c05d8be84dc061e4ae6
- `feat/assembly-f6` 6725e63b2aff7ca12cbec6dc9c15365910e30415
- `feat/assembly-f9` 397311613a9995274fab0ffc930f0ea51f1b33f5
- `feat/simulator-supervisor-ui` 3268bed70f3cddc8d13ebe6801ea25008a7fcd6a
- `feat/supervisor-view` 3fae31faa64cbf36d8b25bb475ab51e56c1bc8aa
- `feat/task-library-robot-assembly` b49f5533f4f1cb60e113b1e7de0b3a3f773b27d1
- `feat/trajectory-observed-quality` 573ed2b5276f1bc6923feb9f530a0347adbebfbb
- `fix/learned-controller-armed-gate` 8c7e9ef2ef09b8b7645a329a47131c62c41c7b15
- `fix/perception-object-guard` f51ed4c25ce446bf390b8b2eab845feb79db5a90
- `fix/review-followups` cccd0ccbcb33b3b42098e1bfd7fa0c789aa61af2
- `josecannete/a3-deploy-hardening` 1d64f39d352bd2e8e0111e7a2e8fe848340cae0e
- `josecannete/cd-demo` 1fb1b411f1c181e0a5639178491bcf8ec285204a
- `josecannete/flight-simulation-brainstorming` dbceaa2d65b15e3a9a5637a240491e7a6725684d
- `josecannete/lockout-plan` 0fdea7f71f5faf0d47877c6115caf75d60bb6611
- `josecannete/lockout-task` 4883b2f791566110f3b27fd969601be613dffd67
- `josecannete/perception-fixes` d87ca4430d0e7127d515ca0b5245646b9eb10cf8
- `josecannete/ra428` 8e4e22f83829d291568eb7b0e93079dd4aa1a231
- `josecannete/repo-state-run` 7298ad7a449ee6da967fea0bf51ae2a424b0956e
- `josecannete/repo-state-run-v3` 020b5ebb011dd302d858e61097d3c1af6a4ceaa9
- `josecannete/repo-state-run-v4` ff4e9d8a0dc23070a4e933ee8e2352378191fc1f
- `josecannete/repo-state-run-v5` ae8f4acd04ab531ef117808e142cbbbc48594d2c
- `josecannete/repo-state-run-v6` 73ccc60b20c35a392670681c0903d005b1678ca5
- `josecannete/vlm-5090` 1a1112f22ccb4a979cacae0996abfe1530d60eb1
- `josecannete/vlm-local-mac` 44962644d968d1c156abb646f842df6de9844efc
- `josecannete/vlm-pipelining` 9f4e93907a055ff259f7e2650fc33a3812cd6b82
- `josecannete/water-cues-confirm` 57f10da10ede40f83ed698cb6ef5ebecda852b7f
- `josecannete/webcam-probe` 9d061f65631f5bf2502f61193cfa86665b9113a0

**Deleted local-only branch** (its commit is on no remote): `worktree-agent-ad3654236dea70ce4` 6ccb55c11deccc2f33225cf052cc708cbef2cc46 (Circuito Vivo YOLO dataset tooling).
