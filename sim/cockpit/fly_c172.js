// Fly many randomized C172 takeoffs and stream them as raw runs for the VLM fine-tuning dataset (owner: Anaís).
// See sim/cockpit/README.md § Dataset.
//
// Paste into the devtools console of `pnpm dev` at /simulador/?task=c172_takeoff (dev build: it drives and
// reads the sim through window.__c172), with `python3 -I sim/cockpit/receiver.py <raw dir>` running, then:
//   await flyC172({ runs: 12, seed: 1 })
// Each run streams 640×480 JPEGs at ~6 fps (the page's capture rate) and ends with `<run>/run.json`: the
// frames and the simulator's ground-truth events, both on simulator time. `app.perception.simruns` turns
// the raw runs into recorded VLM calls + labels. Runs are seeded: the same seed flies the same plan.
(() => {
  const RECEIVER = 'http://localhost:8765/';
  const FPS = 6;
  const SCENARIOS = ['correct', 'correct', 'start_not_ready', 'flaps_full', 'power_with_brake', 'rotate_early'];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sim = () => window.__c172;
  const S = () => sim().state;
  const waitFor = async (pred, what, timeoutMs = 60000) => {
    const t0 = performance.now();
    while (!pred(S())) {
      if (performance.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await sleep(20);
    }
  };
  const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  const tap = async (code) => {
    down(code);
    await sleep(40);
    up(code);
    await sleep(120);
  };
  const holdUntil = async (code, pred, what, timeoutMs) => {
    down(code);
    try {
      await waitFor(pred, what, timeoutMs);
    } finally {
      up(code);
    }
  };
  const post = (name, body) =>
    fetch(RECEIVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...body }) }).then(
      (r) => {
        if (!r.ok) throw new Error(`receiver refused ${name}: HTTP ${r.status}`);
      },
    );
  const mulberry32 = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = (xs, rnd) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));

  /** Stream frames while the run flies; resolves with the frame list when stopped. */
  function streamFrames(runId) {
    const out = document.createElement('canvas');
    out.width = 640;
    out.height = 480;
    const ctx = out.getContext('2d');
    const frames = [];
    const pending = [];
    let lastT = -1;
    const timer = setInterval(() => {
      const t = S().flight.t;
      if (t - lastT < 0.1) return; // the sim didn't advance (hidden tab): no duplicate frame
      lastT = t;
      ctx.drawImage(sim().canvas, 0, 0, 640, 480);
      const seq = frames.length;
      const file = `f_${String(seq).padStart(5, '0')}.jpg`;
      frames.push({ seq, t_ms: Math.round(t * 1000), file });
      pending.push(post(`${runId}/${file}`, { b64: out.toDataURL('image/jpeg', 0.7).split(',')[1] }));
    }, 1000 / FPS);
    return async () => {
      clearInterval(timer);
      await Promise.all(pending);
      return frames;
    };
  }

  async function fly(scenario, rnd) {
    const gap = () => sleep(400 + rnd() * 2000);
    await gap();
    const prep = shuffle(['Digit1', 'Digit2', 'KeyM'], rnd);
    if (scenario === 'start_not_ready') {
      const missing = 1 + Math.floor(rnd() * 2);
      for (const k of prep.slice(0, 3 - missing)) {
        await tap(k);
        await gap();
      }
      down('KeyK'); // key to START with something missing: no start
      await sleep(1500 + rnd() * 1000);
      up('KeyK');
      await gap();
      for (const k of prep.slice(3 - missing)) {
        await tap(k);
        await gap();
      }
    } else {
      for (const k of prep) {
        await tap(k);
        await gap();
      }
    }
    await holdUntil('KeyK', (s) => s.flight.engine === 'running', 'engine running', 8000);
    await gap();
    for (const k of shuffle(['KeyF', 'KeyL'], rnd)) {
      if (k === 'KeyF' && scenario === 'flaps_full') {
        await tap('KeyF');
        await tap('KeyF');
        await tap('KeyF');
        await sleep(2000 + rnd() * 1500);
        await tap('KeyR');
        await tap('KeyR');
      } else {
        await tap(k);
      }
      await gap();
    }
    if (scenario === 'power_with_brake') {
      await holdUntil('KeyE', (s) => s.controls.throttle >= 0.99, 'full throttle');
      await sleep(2000 + rnd() * 1500);
      await holdUntil('KeyQ', (s) => s.controls.throttle <= 0, 'idle');
      await gap();
    }
    await tap('KeyB');
    await gap();
    await holdUntil('KeyE', (s) => s.controls.throttle >= 0.99, 'full throttle');
    if (scenario === 'rotate_early') {
      const v = 35 + rnd() * 10;
      await waitFor((s) => s.flight.airspeedKt >= v, `${v.toFixed(0)} kt`);
      down('ArrowDown');
      await waitFor((s) => s.flight.stall && s.flight.pitchDeg >= 5, 'early rotation', 10000);
      await sleep(1200 + rnd() * 800);
      up('ArrowDown');
    }
    const vr = 55 + rnd() * 4;
    await waitFor((s) => s.flight.airspeedKt >= vr, `${vr.toFixed(0)} kt`);
    const pitch = 7 + rnd() * 1.5;
    await holdUntil('ArrowDown', (s) => !s.flight.onGround && s.flight.pitchDeg >= pitch, 'liftoff');
    await waitFor((s) => s.flight.climbed, 'climb established', 90000);
    await sleep(1500 + rnd() * 1500);
  }

  window.flyC172 = async ({ runs = 12, seed = 1, prefix = 'sim' } = {}) => {
    const done = [];
    for (let i = 0; i < runs; i++) {
      const runSeed = seed + i;
      const scenario = SCENARIOS[i % SCENARIOS.length];
      const runId = `${prefix}${String(runSeed).padStart(3, '0')}_${scenario}`;
      (button('Reiniciar') ?? button('Empezar práctica')).click();
      await sleep(800);
      const stop = streamFrames(runId);
      try {
        await fly(scenario, mulberry32(runSeed));
      } finally {
        for (const k of ['KeyK', 'KeyE', 'KeyQ', 'ArrowDown']) up(k);
      }
      const frames = await stop();
      const events = sim().eventLog.map((e) => ({ t_ms: Math.round(e.t * 1000), action: e.action }));
      const run = { task_id: 'c172_takeoff', run_id: runId, scenario, seed: runSeed, fps: FPS, frames, events };
      await post(`${runId}/run.json`, { text: JSON.stringify(run) + '\n' });
      console.log(`run ${runId}: ${frames.length} frames, ${events.length} events`);
      done.push(runId);
    }
    return done;
  };
})();
