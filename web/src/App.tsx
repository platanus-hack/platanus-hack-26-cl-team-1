// Minimal UI shell (owner: Anaís): task picker, source, live checklist, subtitles, debug (key D).
import { useEffect, useRef, useState } from 'react';
import type { TaskSummary } from './contracts/task_summary';
import type { Debug, Issue, Say, Task, WsServerMessage } from './contracts/ws_server_message';
import { SessionClient } from './session/client';
import { VoicePlayer } from './session/voice';
import { openClip, openWebcam, startCapture } from './source/capture';

type SourceKind = 'webcam' | 'sim';
const FPS = 6;

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [taskId, setTaskId] = useState('');
  const [source, setSource] = useState<SourceKind>('sim');
  const [clip, setClip] = useState<File | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [subtitle, setSubtitle] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [debug, setDebug] = useState<Debug | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState('Desconectado');
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void)[]>([]);
  const sessionRef = useRef(0); // bumped on every start/stop: events from an older session are ignored
  const voiceRef = useRef(new VoicePlayer());

  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json() as Promise<TaskSummary[]>)
      .then((list) => {
        setTasks(list);
        if (list[0]) setTaskId(list[0].id);
      })
      .catch(() => setStatus('No pude cargar las tareas: ¿está corriendo el servidor?'));
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === 'd' && setShowDebug((v) => !v);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onMessage(message: WsServerMessage) {
    switch (message.type) {
      case 'ready':
        setTask(message.task);
        setStatus('Conectado');
        break;
      case 'state':
        setStatuses(message.statuses);
        break;
      case 'issue':
        setIssue(message);
        break;
      case 'issue_clear':
        setIssue(null);
        break;
      case 'say':
        onSay(message);
        break;
      case 'debug':
        if (message.observation) setDebug(message);
        break;
      case 'error':
        setStatus(`Error: ${message.message}`);
        break;
      case 'cancel_say':
        voiceRef.current.cancel(message.id);
        break;
    }
  }

  function onSay(message: Say) {
    setSubtitle(message.text);
    voiceRef.current.say(message);
  }

  async function start() {
    const video = videoRef.current;
    if (!video || !taskId) return;
    stop();
    const session = sessionRef.current;
    const current = () => sessionRef.current === session;
    setTask(null);
    setStatuses({});
    setSubtitle('');
    setIssue(null);
    setDebug(null);
    setStatus('Conectando…');
    try {
      const closeSource = source === 'webcam' ? await openWebcam(video) : clip ? await openClip(video, clip) : null;
      if (!closeSource) {
        setStatus('Elige un video de simulación');
        return;
      }
      if (!current()) {
        closeSource(); // a newer start/stop happened while the camera or clip was opening
        return;
      }
      const client = new SessionClient(
        { type: 'hello', protocol: 1, task_id: taskId, source, debug: true, record: false },
        {
          onMessage: (message) => current() && onMessage(message),
          onAudio: (id, audio) => current() && voiceRef.current.play(id, audio),
          onClose: (reason) => current() && setStatus(`Desconectado: ${reason}`),
        },
      );
      const stopCapture = startCapture(video, FPS, (jpeg) => client.sendFrame(jpeg));
      stopRef.current = [stopCapture, () => client.close(), closeSource];
    } catch (error) {
      setStatus(`No pude empezar: ${String(error)}`);
    }
  }

  function stop() {
    sessionRef.current += 1;
    stopRef.current.forEach((f) => f());
    stopRef.current = [];
    voiceRef.current.stop();
    setStatus('Detenido');
  }

  return (
    <main>
      <header>
        <h1>Supervisor</h1>
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
        <button onClick={stop}>Detener</button>
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
