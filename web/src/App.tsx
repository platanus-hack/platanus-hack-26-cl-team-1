// Minimal UI shell (owner: Anaís): task picker, source, live checklist, subtitles, debug (key D).
import { useEffect, useRef, useState } from 'react';
import type { TaskSummary } from './contracts/task_summary';
import { Nav } from './Nav';
import { apiUrl } from './session/client';
import { useSession } from './session/useSession';
import { openClip, openWebcam } from './source/capture';

type SourceKind = 'webcam' | 'sim';

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [taskId, setTaskId] = useState('');
  const [source, setSource] = useState<SourceKind>('sim');
  const [clip, setClip] = useState<File | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useSession();
  const { task, statuses, subtitle, issue, debug, status } = session.view;

  useEffect(() => {
    fetch(apiUrl('/api/tasks'))
      .then((r) => r.json() as Promise<TaskSummary[]>)
      .then((list) => {
        setTasks(list);
        if (list[0]) setTaskId(list[0].id);
      })
      .catch(() => session.setStatus('No pude cargar las tareas: ¿está corriendo el servidor?'));
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === 'd' && setShowDebug((v) => !v);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    const video = videoRef.current;
    if (!video || !taskId) return;
    const current = session.newAttempt();
    try {
      const closeSource = source === 'webcam' ? await openWebcam(video) : clip ? await openClip(video, clip) : null;
      if (!closeSource) {
        session.setStatus('Elige un video de simulación');
        return;
      }
      if (!current()) {
        closeSource(); // a newer start/stop happened while the camera or clip was opening
        return;
      }
      session.connect(current, { type: 'hello', protocol: 1, task_id: taskId, source, debug: true, record: false }, video, [
        closeSource,
      ]);
    } catch (error) {
      session.setStatus(`No pude empezar: ${String(error)}`);
    }
  }

  return (
    <main>
      <header>
        <h1>Supervisor</h1>
        <Nav current="home" />
        <span className="status">{status}</span>
      </header>
      <section className="controls">
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title_es}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceKind)}>
          <option value="sim">Simulación (video)</option>
          <option value="webcam">Cámara</option>
        </select>
        {source === 'sim' && <input type="file" accept="video/*" onChange={(e) => setClip(e.target.files?.[0] ?? null)} />}
        <button onClick={() => void start()}>Empezar</button>
        <button onClick={() => session.stop()}>Detener</button>
      </section>
      <section className="stage">
        <video ref={videoRef} playsInline muted />
        <ol className="checklist">
          {task?.steps.map((step) => (
            <li key={step.id} className={statuses[step.id] ?? 'pending'}>
              {step.title_es}
            </li>
          ))}
        </ol>
      </section>
      {issue && <div className="issue">{issue.text_es}</div>}
      <p className="subtitle">{subtitle}</p>
      {showDebug && <pre className="debug">{JSON.stringify(debug, null, 2)}</pre>}
    </main>
  );
}
