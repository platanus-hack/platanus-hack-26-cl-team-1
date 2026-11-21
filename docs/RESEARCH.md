# Research: options per component (2026-11-21)

Quick survey done at the pivot. Prices mostly come from third-party pages quoting the vendors; **check
the vendor's pricing page before spending**. Recommendation first, alternatives after.

## 1. Visual simulator ("something like Runway")

**Recommendation: offline clip generation with the Runway API (Gen-4.5 image-to-video, Aleph for
video-to-video), one 5 s clip per (step, correct | mistake).** Local Wan 2.2 on the 3090 as a free
fallback. No real-time world model is usable for this tonight.

| Option | What it is | Cost / access | Fit |
|---|---|---|---|
| **Runway Gen-4.5** (`gen4.5`) | Text/image → video | ~12 credits/s = **$0.12/s** (credits $0.01). 5 s clip ≈ $0.60; 40 clips ≈ $24. API discount on video gen until 2026-11-30 | ✅ Best realism; start each clip from a real photo of our setup (image-to-video) to keep the scene consistent with the webcam |
| **Runway Aleph 2** (`aleph2`) | Video → video editing ("make this hand do X", restyle) | ~28 credits/s = **$0.28/s**, 56-credit minimum | ✅ Turn a real recording of a correct step into a mistake variant, or restyle a cheap render to look real. Closest thing to "sim → real" |
| Runway GWM-1 | Runway's world model line | Only **avatars** have published real-time API pricing (~2 credits / 6 s). The general world model isn't released | ❌ Not available |
| Decart Oasis 3 | Real-time world model, API | ~$0.02/s, ~512×768 @ ~22 fps; **built for driving** | ❌ Wrong domain |
| Odyssey-2 Pro / Odyssey-3 | Real-time interactive video | API for 2 Pro; 3 by application | ⚠️ Interesting, not controllable enough for scripted task steps |
| Google Genie 3 / 4 | Real-time world model | Research preview, trusted testers | ❌ No access |
| **Wan 2.2 TI2V-5B** (local) | Open video gen, Apache 2.0 | Free; ~24 GB VRAM → needs vLLM **stopped**; minutes per 5 s 720p clip | ⚠️ Backup if credits run out; competes with the VLM for the GPU |
| HunyuanVideo 1.5 / LTX-2.3 (local) | Open video gen | Free; offloading needed on 24 GB | ⚠️ Same as above |

Note: "Simulator" also means the **symbolic** simulator (random walks over the task automaton, with
injected mistakes). That one is plain Python and is what trains the controller. Video is for perception
and the demo.

## 2. Video-language model (M_VL, perception)

**Recommendation: Qwen3-VL-8B-Instruct-FP8 on vLLM on the 3090 as the main model** (we deployed and
smoke-tested exactly this stack before the pivot: ~0.5 s per judgment, ~15 GB VRAM, QLoRA pipeline
ready). **A Gemini Flash-class API as the teacher/labeller and fallback** (cheap, strong video input).

| Option | Cost | Latency / limits | Fit |
|---|---|---|---|
| **Qwen3-VL-8B FP8, local (vLLM)** | Free | ~0.5 s per call with 1–2 frames; Apache 2.0; fine-tunable with QLoRA | ✅ Main model; the one we fine-tune (the pitch asks for our own fine-tuning) |
| Qwen3-VL larger (30B-A3B, 235B) | Free / API | 30B-A3B may not fit next to anything else on 24 GB | ⚠️ Teacher via API if needed |
| **Gemini Flash-class (video input)** | Video billed as tokens (~100–260 tokens/s of footage): roughly **$0.002–0.006 per minute** of video | Batch / request-response; good at whole clips | ✅ Label sim clips ("which step, correct or not?") to build the fine-tuning set; fallback perception |
| Gemini Live API | ~$0.002/min video (3rd-party numbers) | **1 fps** video input, streaming session | ⚠️ Tempting for live use, but 1 fps and some Live models were just shut down (2026-11-17); risky to depend on tonight |
| Twelve Labs | ~$0.042/min indexing + $0.029/min analyze | Index-then-query; built for search over libraries | ❌ Wrong shape for live supervision |
| Claude (vision) | Per image tokens | Frames, not video | ⚠️ Good for task generation and as a judge on keyframes, not per-frame |

Lessons from Circuito Vivo that apply here: ask the VLM **on events** (step likely finished, suspected
mistake, stuck for N s), not every frame; force JSON; treat contradictory or low-confidence answers as
"uncertain" → say nothing.

## 3. Controller model (M_C)

**Recommendation: build it in two layers, from scratch.**

1. **Automaton tracker (rules, no training).** Keeps the current state of the task's state machine;
   an observation of action `a` is legal → advance; illegal → mistake + the correction the task defines;
   nothing for N seconds → remind the next step. This is the baseline and the safety rail.
2. **Learned controller trained on symbolic simulator trajectories.** Input: the sequence of noisy
   observations (action ids + confidences) and the task id; output: current step, is-mistake, next
   action. A small GRU / tiny transformer (well under 1M params, trains in minutes on the 3090 or CPU),
   with the output **masked to the task's legal actions**. Train with simulated perception noise
   (dropped, confused, delayed observations) so it learns to be robust where rules are brittle. This
   gives a real before/after table: rules vs learned, at increasing noise levels.

Why not an LLM as the controller: it works zero-shot (Claude Haiku with the automaton in the prompt is a
good stretch baseline), but it's slower, costs per call, and is harder to show "our own fine-tuning".

Prior art that matches this design (procedural mistake detection on egocentric video):

- **PROVIA** (arXiv 2609.20638): tracks procedure state and per-actor status (correct / mistake /
  correction); on HoloAssist, 89% of detections come before the next step, median 0.5 s after the mistake.
- **TI-PREGO** (arXiv 2411.02570): two branches, step recognition + next-step anticipation; a mismatch = mistake.
  Basically our M_VL + M_C split.
- **Differentiable Task Graph Learning** (arXiv 2406.01486): learns the task graph (our automaton) from
  videos; online mistake detection.
- **Online Mistake Detection in Instruction-Conditioned Procedural Video** (arXiv 2611.25567): joint model
  beats a modular pipeline on mistake F1 (84.1 vs 80.7), biggest gain on slips. Worth a look later; the
  modular pipeline is the right call for a hackathon.
- Datasets for terminology / possible extra data: HoloAssist, CaptainCook4D, Ego4D Goal-Step, Assembly101.

## 4. Text-to-speech

**Recommendation: ElevenLabs Flash v2.5, streaming (WebSocket when text arrives incrementally).**
Supports Spanish (32 languages); ~75 ms model time, ~100 ms server-side median, **~200 ms end to end**
in an independent benchmark. Price quotes vary ($20–50 per million characters); a demo uses a few thousand.
Reuse the anti-spam queue from the old `speaker.py`. Keep the browser's `speechSynthesis` as an offline fallback.

## 5. Task / step generation

**Claude API** (team has access; the old `backend/app/agent/client.py` shows the streaming + tool-use
setup, with `ANTHROPIC_BASE_URL` for the hackathon proxy). Use structured output against the
`task.json` schema, then validate in code (actions in the ontology, automaton reachable and acyclic
where required, every mistake has a correction). Claude also writes the per-step prompts for video generation.

## Sources

- Runway API pricing: https://docs.dev.runwayml.com/guides/pricing/ · models: https://docs.dev.runwayml.com/guides/models/
- Runway Gen-4.5 / Aleph 2 on OpenRouter: https://openrouter.ai/runway/gen-4.5 · https://openrouter.ai/runway/aleph-2
- Real-time video APIs roundup: https://omidsaffari.com/blog/best-real-time-ai-video-generation-apis-2026
- Decart Oasis 3: https://techcrunch.com/2026/06/10/decarts-new-world-model-can-simulate-hours-of-photorealistic-driving-with-some-caveats/
- World models comparison: https://ltx.io/blog/best-world-models · https://livegen.ai/best/real-time-ai-video-models
- Genie 3: https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/
- Open video gen on local GPUs: https://reapi.ai/blog/best-open-source-ai-video-models-local-gpu-2026
- Video analysis costs: https://aicostcheck.com/blog/ai-video-analysis-costs-2026 · https://www.twelvelabs.io/pricing-calculator
- Gemini Live limits: https://firebase.google.com/docs/ai-logic/live-api/limits-and-specs · pricing: https://ai.google.dev/gemini-api/docs/pricing
- Qwen3-VL technical report: https://arxiv.org/pdf/2511.21631
- PROVIA: https://arxiv.org/abs/2609.20638 · TI-PREGO: https://arxiv.org/abs/2411.02570 · Task graphs: https://arxiv.org/pdf/2406.01486 · Instruction-conditioned: https://arxiv.org/abs/2611.25567
- ElevenLabs latency: https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization · benchmark: https://humannessindex.vapi.ai/models/elevenlabs-flash-v2-5
