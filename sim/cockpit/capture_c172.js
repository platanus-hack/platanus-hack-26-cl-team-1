// Capture labeled cockpit frame pairs for the C172 takeoff (owner: Anaís). See sim/cockpit/README.md.
//
// Paste into the devtools console of `pnpm dev` at /simulador/?task=c172_takeoff (dev build: it reads the
// sim through window.__c172), with `python3 sim/cockpit/receiver.py <out dir>` running. It flies a correct
// run and then each task mistake, and saves, per case, the frame before (`_a`) and ~1 s after (`_b`) the
// action as the same 640×480 JPEG the session sends, plus cases.json with the expected VLM action and the
// steps already done (which give the prompt's "expected next").
(async () => {
  const RECEIVER = 'http://localhost:8765/';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = () => window.__c172.state;
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
    await sleep(200);
  };
  const holdUntil = async (code, pred, what) => {
    down(code);
    try {
      await waitFor(pred, what);
    } finally {
      up(code);
    }
  };
  const post = (name, body) =>
    fetch(RECEIVER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...body }) });
  const out = document.createElement('canvas');
  out.width = 640;
  out.height = 480;
  const octx = out.getContext('2d');
  const cap = async (name) => {
    octx.drawImage(window.__c172.canvas, 0, 0, 640, 480);
    await post(name, { b64: out.toDataURL('image/jpeg', 0.7).split(',')[1] });
  };
  const cases = [];
  const pair = async (name, expected, done, act, settleMs = 1000) => {
    await cap(`${name}_a.jpg`);
    await act();
    await sleep(settleMs);
    await cap(`${name}_b.jpg`);
    cases.push({ name, expected, done: [...done] });
  };
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  const restart = async () => {
    (button('Reiniciar') ?? button('Empezar práctica')).click();
    await sleep(800);
  };

  // ── correct run ──
  await restart();
  const d = [];
  await pair('c00_idle', null, d, async () => {});
  await pair('c01_master', 'turn_master_on', d, () => tap('Digit1'));
  d.push('master_on');
  await pair('c02_fuel', 'set_fuel_both', d, () => tap('Digit2'));
  d.push('fuel_on');
  await pair('c03_mixture', 'set_mixture_rich', d, () => tap('KeyM'));
  d.push('mixture_rich');
  await cap('c04_start_a.jpg');
  down('KeyK');
  await waitFor((s) => s.flight.crankS >= 0.9, 'cranking');
  await cap('c04_start_b.jpg');
  cases.push({ name: 'c04_start', expected: 'start_engine', done: [...d] });
  await waitFor((s) => s.flight.engine === 'running', 'engine running');
  up('KeyK');
  await waitFor((s) => s.flight.rpm >= 880, 'idle rpm');
  await pair('c05_running', 'start_engine', d, async () => {});
  d.push('engine_start');
  await pair('c06_flaps10', 'set_flaps_takeoff', d, () => tap('KeyF'));
  d.push('flaps_10');
  await pair('c07_land', 'turn_landing_light_on', d, () => tap('KeyL'));
  d.push('landing_light');
  await pair('c08_brake', 'release_parking_brake', d, () => tap('KeyB'));
  d.push('brake_release');
  await pair('c09_power', 'apply_full_throttle', d, () => holdUntil('KeyE', (s) => s.controls.throttle >= 0.99, 'full throttle'));
  d.push('full_power');
  await waitFor((s) => s.flight.airspeedKt >= 56, '56 kt');
  await pair('c10_rotate', 'rotate', d, () => holdUntil('ArrowDown', (s) => !s.flight.onGround && s.flight.pitchDeg >= 7.5, 'liftoff'), 800);
  d.push('rotate');
  await waitFor((s) => s.flight.climbed, 'climb established', 90000);
  await pair('c11_climb', 'establish_climb', d, async () => {});

  // ── mistakes ──
  await restart();
  const m = [];
  await tap('Digit1');
  m.push('master_on');
  await cap('m01_start_not_ready_a.jpg');
  down('KeyK');
  await waitFor((s) => s.flight.crankS >= 0.9, 'cranking');
  await sleep(400);
  await cap('m01_start_not_ready_b.jpg');
  up('KeyK');
  cases.push({ name: 'm01_start_not_ready', expected: 'start_engine', done: [...m] });
  await tap('Digit2');
  await tap('KeyM');
  m.push('fuel_on', 'mixture_rich');
  await holdUntil('KeyK', (s) => s.flight.engine === 'running', 'engine running');
  m.push('engine_start');
  await waitFor((s) => s.flight.rpm >= 880, 'idle rpm');
  await pair('m02_flaps_full', 'set_flaps_full', m, async () => {
    await tap('KeyF');
    await tap('KeyF');
    await tap('KeyF');
  }, 2500); // flaps travel ~5°/s: let the indicator reach 30
  await tap('KeyR');
  await tap('KeyR');
  m.push('flaps_10');
  await tap('KeyL');
  m.push('landing_light');
  await sleep(2500);
  await pair('m03_power_with_brake', 'apply_full_throttle', m, () => holdUntil('KeyE', (s) => s.controls.throttle >= 0.99, 'full throttle'));
  await holdUntil('KeyQ', (s) => s.controls.throttle <= 0, 'idle');
  await tap('KeyB');
  m.push('brake_release');
  await holdUntil('KeyE', (s) => s.controls.throttle >= 0.99, 'full throttle');
  m.push('full_power');
  await waitFor((s) => s.flight.airspeedKt >= 38, '38 kt');
  // Keep pulling while the after-frame is taken: on the ground the nose drops (and STALL clears) on release.
  await cap('m04_rotate_early_a.jpg');
  down('ArrowDown');
  await waitFor((s) => s.flight.stall && s.flight.pitchDeg >= 6, 'early rotation');
  await sleep(500);
  await cap('m04_rotate_early_b.jpg');
  up('ArrowDown');
  cases.push({ name: 'm04_rotate_early', expected: 'rotate_early', done: [...m] });

  await post('cases.json', { text: JSON.stringify({ task_id: 'c172_takeoff', cases }, null, 2) + '\n' });
  console.log(`captured ${cases.length} cases`);
  return cases.length;
})();
