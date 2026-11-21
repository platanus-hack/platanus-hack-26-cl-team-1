// Simulator page (owner: Anaís): pick a library project, then practice it live with the supervisor or
// record an expert run as training data. Design: docs/superpowers/specs/2026-11-21-simulator-page-design.md
//
// Practice streams the simulator's canvas through the normal session (hello.task_id = the project, so the
// perception prompt and the controller use its recipe). Only video goes to the server: the simulator's
// ground truth stays in the page (debug overlay, recording labels).
import { useEffect, useRef, useState } from 'react';
import type { TaskSummary } from '../contracts/task_summary';
import type { Task } from '../contracts/ws_server_message';
import { Nav } from '../Nav';
import { apiUrl } from '../session/server';
import { useSession } from '../session/useSession';
import { CanvasRecorder, doneSteps, type Labeled, labelRun, newRunId, sendRecordingMock } from './recording';
import { SIMULATORS } from './registry';
import type { SimEvent, Simulator } from './types';

type Mode = 'practice' | 'record';
type Recording =
  | { phase: 'idle' }
  | { phase: 'recording'; runId: string; recorder: CanvasRecorder }
  | { phase: 'review'; runId: string; video: Blob; durationS: number; labeled: Labeled }
  | { phase: 'sent'; runId: string; clips: number };

const MODES: Record<Mode, { title: string; blurb: string }> = {
  practice: {
    title: 'Práctica',
    blurb: 'En vivo. El supervisor mira la cabina, te dice el siguiente paso y te corrige si te equivocas.',
  },
  record: {
    title: 'Grabación (experto)',
    blurb: 'Un experto hace la tarea correctamente. Se graba y se envía después como datos de entrenamiento.',
  },
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function SimulatorPage() {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [taskId, setTaskId] = useState<string | null>(() => new URLSearchParams(location.search).get('task'));

  useEffect(() => {
    fetch(apiUrl('/api/tasks'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TaskSummary[]>;
      })
      .then(setTasks)
      .catch((e) => setLoadError(`No pude cargar los proyectos (${String(e)}): ¿está corriendo el servidor?`));
  }, []);

  return (
    <main className="sim-page">
      <header>
        <h1>Simulador</h1>
        <Nav current="simulator" />
      </header>
      {taskId && SIMULATORS[taskId] ? (
        <Project taskId={taskId} onBack={() => setTaskId(null)} />
      ) : (
        <ProjectPicker tasks={tasks} error={loadError} onPick={setTaskId} />
      )}
    </main>
  );
}

function ProjectPicker({ tasks, error, onPick }: { tasks: TaskSummary[] | null; error: string; onPick: (id: string) => void }) {
  if (error) return <p className="issue">{error}</p>;
  if (!tasks) return <p className="status">Cargando proyectos…</p>;
  return (
    <section>
      <p className="lead">Elige un proyecto de la biblioteca para simularlo.</p>
      <div className="projects">
        {tasks.map((t) => {
          const sim = SIMULATORS[t.id];
          return (
            <button key={t.id} className="project" disabled={!sim} onClick={() => onPick(t.id)}>
              <span className="project-title">{t.title_es}</span>
              <span className="project-meta">
                {t.steps} pasos · {t.domain}
              </span>
              <span className={sim ? 'badge' : 'badge off'}>{sim ? sim.name : 'Sin simulador todavía'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Project({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('practice');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [recording, setRecording] = useState<Recording>({ phase: 'idle' });
  const [simulator, setSimulator] = useState<Simulator | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<SimEvent[]>([]);
  const session = useSession();

  useEffect(() => {
    fetch(apiUrl(`/api/tasks/${taskId}`))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Task>;
      })
      .then(setTask)
      .catch((e) => setError(`No pude cargar el proyecto: ${String(e)}`));
    const sim = SIMULATORS[taskId].create();
    holder.current?.replaceChildren(sim.canvas);
    let alive = true;
    sim
      .load()
      .then(() => alive && setSimulator(sim))
      .catch((e) => setError(`No pude cargar el simulador: ${String(e)}`));
    const onKey = (e: KeyboardEvent) => e.code === 'KeyD' && setShowDebug((v) => !v);
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
      sim.dispose();
    };
  }, [taskId]);

  useEffect(() => simulator?.setMuted(muted), [simulator, muted]);

  /** Start the simulator. `clock` re-stamps its events (recording: the video's clock, not sim time). */
  function runSim(sim: Simulator, clock?: () => number) {
    eventsRef.current = [];
    setEvents([]);
    sim.start((event) => {
      eventsRef.current = [...eventsRef.current, clock ? { ...event, t: clock() } : event];
      setEvents(eventsRef.current);
    });
    setRunning(true);
  }

  function stopAll(status = 'Detenido') {
    simulator?.stop();
    session.stop(status);
    setRunning(false);
  }

  function startPractice() {
    if (!simulator) return;
    const current = session.newAttempt();
    runSim(simulator);
    session.connect(current, { type: 'hello', protocol: 1, task_id: taskId, source: 'sim', debug: true, record: false }, simulator.canvas, [
      () => simulator.stop(),
    ]);
  }

  function restartPractice() {
    if (!simulator) return;
    runSim(simulator);
    session.send({ type: 'reset' });
  }

  function startRecording() {
    if (!simulator) return;
    try {
      const recorder = new CanvasRecorder(simulator.canvas);
      recorder.start();
      // Labels must line up with the video: sim time stops when the tab is hidden, the video doesn't.
      runSim(simulator, () => recorder.elapsedS());
      setRecording({ phase: 'recording', runId: newRunId(), recorder });
    } catch (e) {
      setError(String(e));
    }
  }

  async function finishRecording() {
    if (recording.phase !== 'recording' || !task) return;
    const { video, durationS } = await recording.recorder.stop();
    simulator?.stop();
    setRunning(false);
    // Expert runs are fine-tuning data, so the whole run is `train`; eval runs come from elsewhere.
    const labeled = labelRun(task, recording.runId, eventsRef.current, durationS, 'train');
    setRecording({ phase: 'review', runId: recording.runId, video, durationS, labeled });
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (recording.phase === 'recording') void recording.recorder.stop();
    stopAll('Desconectado');
    setRecording({ phase: 'idle' });
    setMode(next);
  }

  // Checklist: practice shows what the supervisor believes (server statuses); recording shows the
  // simulator's ground truth, as a guide for the expert.
  const checklist = (() => {
    const steps = task?.steps ?? [];
    if (mode === 'practice') return steps.map((s) => ({ step: s, status: session.view.statuses[s.id] ?? 'pending' }));
    const done = doneSteps(task ?? ({ steps: [] } as unknown as Task), events);
    return steps.map((s) => ({
      step: s,
      status: done.has(s.id) ? 'done' : (s.requires ?? []).every((r) => done.has(r)) ? 'active' : 'pending',
    }));
  })();

  const { issue, subtitle, debug, status } = session.view;

  return (
    <section className="project-view">
      <div className="project-bar">
        <button className="link" onClick={() => { stopAll(); onBack(); }}>
          ← Proyectos
        </button>
        <h2>{task?.title_es ?? '…'}</h2>
        <div className="modes" role="tablist">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'mode on' : 'mode'} onClick={() => switchMode(m)}>
              {MODES[m].title}
            </button>
          ))}
        </div>
      </div>
      <p className="lead">{MODES[mode].blurb}</p>
      {error && <p className="issue">{error}</p>}

      <div className="sim-stage">
        <div className="sim-view">
          <div className="sim-canvas" ref={holder} />
          {!running && simulator && <div className="sim-overlay">Pulsa «Empezar» y vuela con el teclado</div>}
          {!simulator && !error && <div className="sim-overlay">Cargando cabina…</div>}
          {mode === 'practice' && issue && <div className="issue sim-issue">{issue.text_es}</div>}
          {mode === 'practice' && subtitle && <p className="subtitle sim-subtitle">{subtitle}</p>}
          {recording.phase === 'recording' && <span className="rec-dot">● GRABANDO</span>}
        </div>

        <aside className="sim-side">
          <div className="controls">
            {mode === 'practice' ? (
              running ? (
                <>
                  <button onClick={restartPractice}>Reiniciar</button>
                  <button onClick={() => stopAll()}>Detener</button>
                </>
              ) : (
                <button className="primary" disabled={!simulator || !task} onClick={startPractice}>
                  Empezar práctica
                </button>
              )
            ) : recording.phase === 'recording' ? (
              <button className="primary danger" onClick={() => void finishRecording()}>
                Terminar grabación
              </button>
            ) : (
              <button className="primary" disabled={!simulator || !task} onClick={startRecording}>
                Empezar grabación
              </button>
            )}
            <label className="toggle">
              <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Silenciar motor
            </label>
          </div>
          {mode === 'practice' && <p className="status">{status}</p>}

          {recording.phase === 'review' && (
            <div className="card">
              <strong>Grabación lista</strong>
              <p>
                {fmt(recording.durationS)} · {recording.labeled.clips.length} clips etiquetados
                {recording.labeled.dropped.length > 0 && ` · ${recording.labeled.dropped.length} descartados`}
              </p>
              {recording.labeled.dropped.map((d) => (
                <p key={`${d.t}-${d.action}`} className="status">
                  {fmt(d.t)} {d.action}: {d.reason}
                </p>
              ))}
              <div className="controls">
                <button
                  className="primary"
                  onClick={() => {
                    sendRecordingMock(recording.runId, recording.video, recording.labeled);
                    setRecording({ phase: 'sent', runId: recording.runId, clips: recording.labeled.clips.length });
                  }}
                >
                  Enviar (simulado)
                </button>
                <button onClick={() => setRecording({ phase: 'idle' })}>Descartar</button>
              </div>
              <p className="status">Todavía no hay servidor que reciba grabaciones: se descargan el video y sus etiquetas.</p>
            </div>
          )}
          {recording.phase === 'sent' && (
            <div className="card">
              <strong>Enviado (simulado)</strong>
              <p className="status">
                Se descargaron {recording.runId}.webm y {recording.runId}.clips.jsonl ({recording.clips} clips).
              </p>
            </div>
          )}

          <h3>Pasos</h3>
          <ol className="checklist">
            {checklist.map(({ step, status: s }) => (
              <li key={step.id} className={s}>
                {step.title_es}
              </li>
            ))}
          </ol>

          <h3>Teclas</h3>
          <dl className="legend">
            {(simulator?.legend ?? []).map((k) => (
              <div key={k.keys}>
                <dt>{k.keys}</dt>
                <dd>{k.label}</dd>
              </div>
            ))}
          </dl>
          <p className="status">D: panel de depuración</p>
        </aside>
      </div>

      {showDebug && (
        <div className="debug-grid">
          <pre className="debug">
            {'Simulador (verdad):\n' + events.slice(-8).map((e) => `${e.t.toFixed(1)}s ${e.action}`).join('\n')}
          </pre>
          {mode === 'practice' && <pre className="debug">{'Modelo:\n' + JSON.stringify(debug, null, 2)}</pre>}
        </div>
      )}
    </section>
  );
}
