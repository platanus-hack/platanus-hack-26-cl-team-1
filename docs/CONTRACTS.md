# Circuito Vivo — contracts & ownership

Educational web app (desktop, **Spanish UI**) to simulate basic electronics and
program an **Arduino Uno** or **ESP32-C6** with blocks.

- Frontend: Vite + React 19 + TypeScript 7 + Zustand 5, own SVG renderers, ELK.js, Blockly 13
- Backend: FastAPI + Celery + Redis, `arduino-cli` compile worker, Claude agent (Anthropic SDK)
- Theme: dark `#0E1217`, Inter (UI) + JetBrains Mono (code/values). Tokens in `frontend/src/app/theme.css`.

## The 6 contracts (source of truth = these files)

| # | Contract | File |
|---|---|---|
| 1 | `ProjectModel` (parts, wires, program) + derived `Netlist`, `Net`, `Binding` | `frontend/src/contracts/model.ts` |
| 2 | `Op` list, effects, inverse, transactions | `frontend/src/contracts/ops.ts` (reducer: `store/applyOp.ts`) |
| 3 | Block IR (`ProgramIR`, `Stmt`, `Expr`) | `frontend/src/contracts/ir.ts` |
| 4 | Agent tools + SSE protocol | `shared/agent-tools.json` + `frontend/src/contracts/agent.ts` |
| 5 | Parts library entry (`PartDef`) | `frontend/src/contracts/parts.ts` + data in `shared/parts/*.json` |
| 6 | Board profile (`BoardProfile`) | `frontend/src/contracts/board.ts` + data in `shared/boards/*.json` |
| – | Sim / checks / guide / compile result types | `frontend/src/contracts/sim.ts` |

### Key conventions
- **Grid units**: 1 unit = 0.1 in = 2.54 mm. Part origins & pin coords are integers. SVG renderers draw in grid units in the part's local unrotated frame; the canvas applies `translate(x y) rotate(r)`. `GRID_PX = 16` px per unit at zoom 1.
- **Connectivity**: pins at the same world grid point are connected (legs in breadboard holes, LED legs pushed into a header); wires join `from`/`to`; `internalBuses` join pins inside a part (breadboard strips, button pairs, board GNDs).
- **PinRef** = `"partId.pinId"` (`led1.anode`, `uno1.D13`, `bb1.a10`, `bb1.T+3`). Use `lib/pinref.ts`.
- **Breadboard** geometry: `frontend/src/catalog/breadboard.ts` (cols 1–30 at x=col+1, rows a–e y=5..9, f–j y=12..16, rails T+ y=1, T− y=2, B+ y=19, B− y=20).
- **All project mutations** go through `useProject.getState().dispatch(ops, {label, source, mergeKey})` → one undo step. Never mutate `project` directly.
- **Electrical sim is always live** (board powered by USB). The **program** runs only after ▶ Ejecutar.
- Spanish for every user-visible string. Code identifiers in English.

## Rules digest (read the contract files for details)
- **Overlap connects only male↔female** (`PinDef.contact`): breadboard holes + Uno header sockets are female; legs, leads, servo connector, ESP32 header pins are male. Wires connect anything. Holes under another part's body are *covered* (not free).
- **Power**: only `supply.rails` of the active board are sources (with `sourceOhms`); batteries are sources. A source whose +/− share a net → `shorts`.
- **Canonical board pins**: `aliasOf` (Uno SDA→A4, SCL→A5, IOREF→5V) is resolved everywhere (bindings, drives, IR, dropdowns). `canonicalBoardPin()` in catalog.
- **Bindings**: one per (part, channel); walk through resistors/diodes and from an NPN collector to its base; `activeLow` = ON when the pin is LOW (inputs and outputs); `invert` for analog sensors; `driver: 'npn'`.
- **PWM/tone effects** are applied by `solveCircuit` (brightness/speed × duty of the bound pin; buzzer is **passive**: sounds only with `toneHz`). Currents are peak values.
- **CircuitResult.project** = the project it was solved for. Never mix a stale result with a new netlist (`getFreshResult`). Views key overlays by part id / wire id / PinRef, never NetId.
- **Block IR numeric model**: numbers are `double`, real division, `fmod`, `cv_map`, `cvPrint` formatting, implicit setup rules, sensor formulas — see `contracts/ir.ts`. ctx.board wins over ir.board; `repeat` evaluates N once; tone < 1 Hz = noTone; ESP32 PWM channels are limited (`maxPwmChannels`).
- **Interpreter protocol**: `waiting | yield | done | error`, 0.01 ms per statement, ≥ 0.1 ms per loop pass; the host re-solves before reads.
- **Undo grouping**: `DispatchMeta.group` merges a whole agent turn into one undo step; `mergeKey` merges drags within 1 s. `wire.remove` of an already-removed wire is a no-op.
- **Agent**: the server never modifies `messages`; the client embeds `<contexto_app>` in its own user messages; tools run only after `message_end` with `tool_use`; see the CLIENT/SERVER RULES in `contracts/agent.ts`.
- **Program checks** live in `program/codegen.programChecks` and are merged with circuit checks by `store/derived.getIssues/useIssues`.
- **Compile**: sketch compiled verbatim (`sketch/sketch.ino`), toolchain facts in `BoardProfile.toolchain`; the frontend maps diagnostics → blocks via `lineMap`; last compile shared through `useCompile` (`@/flash`).
- **Interactive parts**: renderers tag actuators with `data-actuator="<propKey>"`; the canvas handles the pointer events.

## Module ownership (each agent edits ONLY its folders)

| Workstream | Owner area (frontend/src unless noted) | Public API (keep signatures) |
|---|---|---|
| Core (lead) | `contracts/`, `catalog/`, `lib/`, `store/`, `app/`, `program/context.ts`, `parts/{types,registry,defs,PartThumbnail,FallbackRenderer}` | — |
| A1 Circuit | `circuit/**` | `buildNetlist`, `solveCircuit`, `deriveBindings`, `runChecks`, `idleInputs` |
| A2a Art: boards & power | `parts/boards/**` (+ may add `cv-*` defs to `parts/defs.tsx`) | `boardRenderers` |
| A2b Art: components | `parts/components/**` | `componentRenderers` |
| A3 Hardware view | `views/hardware/**` | `<HardwareView/>` (hosts palette, canvas, inspector, checks, guide panel, schematic toggle) |
| A4 Schematic, guide, placement, examples | `views/schematic/**`, `guide/**`, `placement/**`, `examples/**` | `<SchematicView/>`, `buildWiringGuide`, `<WiringGuidePanel/>`, `planAddPart`, `planConnect`, `findFreeSpot`, `EXAMPLES`, `buildExample` |
| B1 Blocks | `program/blocks/**`, `views/software/**` | `registerBlocks`, `buildToolbox`, `workspaceToIR`, `irToWorkspace`, `getProgramIR`, `<SoftwareView/>` |
| B2 Codegen + interpreter | `program/codegen/**`, `program/interpreter/**` | `generateCode`, `createInterpreter` (+ `InterpreterHost`) |
| B3 Sim runtime | `sim/**`, `views/sim/**` | `simRuntime.{init,startProgram,pauseProgram,stopProgram,reset}`, `runHeadless`, `<SimPanel/>` |
| B4 Compile & flash | `flash/**`, `backend/app/compile/**`, `backend/tests/test_compile*.py`, `docker/**` | `compileSketch`, `flashArtifact`, `downloadArtifact`, `webSerialSupported`, `<CompilePanel/>`; HTTP `POST /api/compile`, `GET /api/compile/{id}`, `GET /api/compile/{id}/artifact` |
| C Agent | `agent/**`, `backend/app/agent/**`, `backend/tests/test_agent*.py` | `<AgentPanel/>`, `executeTool`, `describeToolCall`; HTTP `POST /api/agent/turn` (SSE) |

Cross-module imports are allowed **only through the public APIs above**
(e.g. the agent imports `planAddPart` from `@/placement`, never internal files).

## Data flow

```
             ┌──────────── dispatch(ops) ────────────┐
 UI / agent ─┤                                        ▼
             │                              useProject.project (ProjectModel)
             │                                        │
             │       getNetlist ◀─ circuit.buildNetlist (memoized per project object)
             │       getBindings ◀─ circuit.deriveBindings
             │                                        │
 Blockly ─ program.set(workspace) ─▶ getProgramIR ─ workspaceToIR ─▶ ProgramIR
                                                      │                 │
                                     codegen.generateCode        interpreter (virtual time)
                                                      │                 │ InterpreterHost
                                          POST /api/compile      sim/runtime ─ solveCircuit ─▶ useSim.result
                                          Celery → arduino-cli                                   │
                                          .hex/.bin → download / Web Serial flash     views render glow, current flow
```

## Running locally

Prerequisites: Node 20+ with pnpm, Python 3.11 with uv, Redis, and `arduino-cli` with the
`arduino:avr` and `esp32:esp32` (≥ 3.0) cores. On macOS the CLI bundled in Arduino IDE.app
is picked up automatically; otherwise set `ARDUINO_CLI` in `backend/.env`. Libraries
`Servo` / `ESP32Servo` are installed by the worker on first use.

```bash
make install                 # pnpm install + uv sync
cp backend/.env.example backend/.env   # add ANTHROPIC_API_KEY for the assistant
make dev                     # redis + API :8000 + Celery worker + Vite :5173
```

Or each piece by hand:

```bash
redis-server &
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd backend && uv run celery -A app.compile.celery_app worker -l info -c 2
cd frontend && pnpm dev      # http://localhost:5173 (proxies /api → :8000)
```

Checks: `make typecheck`, `make test` (vitest + pytest). Part art QA:
`frontend/scripts/render-parts.sh` renders every part to PNG (red crosses = pin positions).
Docker: `docker compose up --build` (redis, api, worker with arduino-cli, nginx web).
