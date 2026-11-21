// The supervisor page (owner: Anaís): a real camera (the iPhone over Continuity Camera on the demo Mac)
// streams to the session server; the page shows the checklist, the current correction, subtitles and a
// debug view, and plays the supervisor's voice. A dropped connection or camera is shown loudly, with a
// "Reconectar" button: no silent auto-reconnect (CLAUDE.md: never fail silently).
import { useEffect, useRef, useState } from 'react';
import type { TaskSummary } from '../contracts/task_summary';
import type { Debug, Issue, Task, WsServerMessage } from '../contracts/ws_server_message';
import { SessionClient } from '../session/client';
import { describeLoss, type Loss } from '../session/loss';
import { apiUrl, serverUrls } from '../session/server';
import { VoicePlayer } from '../session/voice';
import { cameraForReconnect, cameraToOpen, loadCameraId, saveCameraId } from '../source/camera';
import { listCameras, openWebcam, startCapture, type Camera } from '../source/capture';

const FPS = 6;

type Connection = 'idle' | 'connecting' | 'live' | 'lost';

export function SupervisorPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [taskId, setTaskId] = useState('');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [cameraNote, setCameraNote] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [subtitle, setSubtitle] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [debug, setDebug] = useState<Debug | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState('Desconectado');
  const [statusError, setStatusError] = useState(false);
  const [connection, setConnection] = useState<Connection>('idle');
  const [lostReason, setLostReason] = useState('');
  const [aspect, setAspect] = useState(16 / 9);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void)[]>([]);
  const sessionRef = useRef(0); // bumped on every start/stop: events from an older session are ignored
  const voiceRef = useRef(new VoicePlayer());
  const chosenCameraRef = useRef<string | null>(null); // picked in this page; wins whenever it's connected
  const serverErrorRef = useRef<string | null>(null); // the server sends `error`, then closes
  const sessionCameraRef = useRef<string | null>(null); // the camera "Reconectar" goes back to
  const runningRef = useRef(false);
  const pendingRefreshRef = useRef(false); // a camera list change arrived during a session
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let base = '';
    try {
      base = serverUrls().http;
    } catch (error) {
      setStatus(`Dirección del servidor inválida: ${String(error)}`);
      return;
    }
    fetch(apiUrl('/api/tasks'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TaskSummary[]>;
      })
      .then((list) => {
        setTasks(list);
        if (list[0]) setTaskId(list[0].id);
        else setStatus('El servidor no tiene tareas.');
      })
      .catch(() => setStatus(`No pude cargar las tareas desde ${base}: ¿está corriendo el servidor?`));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd' && !(e.target instanceof HTMLSelectElement)) setShowDebug((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) {
      // Browsers only expose cameras on secure origins (https or localhost).
      setCameraNote('La cámara solo funciona en https o en localhost.');
      return;
    }
    let alive = true;
    async function refresh() {
      if (runningRef.current) {
        pendingRefreshRef.current = true; // don't change the picker under a live session; redo it on stop
        return;
      }
      const list = await listCameras();
      if (!alive) return;
      const choice = cameraToOpen(list, chosenCameraRef.current, loadCameraId());
      setCameras(list);
      setCameraId(choice.deviceId);
      if (list.length === 0) setCameraNote('No hay cámaras conectadas.');
      else if (choice.missing) {
        setCameraNote(`No encontré la cámara guardada; uso ${list.find((c) => c.deviceId === choice.deviceId)?.label || 'la predeterminada'}.`);
      } else setCameraNote('');
    }
    async function init() {
      try {
        // Ask once so the camera labels (e.g. the iPhone's) show up in the list.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      } catch {
        if (alive) setCameraNote('Sin permiso para usar la cámara.');
        return;
      }
      await refresh();
    }
    const onChange = () => void refresh().catch((error: unknown) => setCameraNote(`No pude listar las cámaras: ${String(error)}`));
    refreshRef.current = onChange;
    void init().catch((error: unknown) => setCameraNote(`No pude listar las cámaras: ${String(error)}`));
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
    };
  }, []);

  function chooseCamera(id: string) {
    chosenCameraRef.current = id;
    sessionCameraRef.current = id; // an explicit pick is also what "Reconectar" should use
    setCameraId(id);
    setCameraNote('');
    saveCameraId(id);
  }

  function onMessage(message: WsServerMessage) {
    switch (message.type) {
      case 'ready':
        setTask(message.task);
        setConnection('live');
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
        setSubtitle(message.text);
        voiceRef.current.say(message);
        break;
      case 'debug':
        if (message.observation) setDebug(message);
        break;
      case 'error':
        serverErrorRef.current = message.message;
        setStatus(`Error del servidor: ${message.message}`);
        setStatusError(true);
        break;
      case 'cancel_say':
        voiceRef.current.cancel(message.id);
        break;
    }
  }

  function lose(loss: Loss) {
    stop();
    const text = describeLoss(loss);
    setConnection('lost');
    setLostReason(text);
    setStatus(text);
  }

  async function reconnect() {
    const last = sessionCameraRef.current;
    if (!last) return start(cameraId);
    let deviceId: string | null = null;
    try {
      deviceId = cameraForReconnect(await listCameras(), last);
    } catch (error) {
      setLostReason(`No pude listar las cámaras: ${String(error)}`);
      return;
    }
    if (!deviceId) {
      const text = 'La cámara de la sesión no está conectada: conéctala de nuevo o elige otra cámara.';
      setLostReason(text);
      setStatus(text);
      return;
    }
    return start(deviceId);
  }

  async function start(deviceId: string | null) {
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
    setLostReason('');
    serverErrorRef.current = null;
    setStatusError(false);
    setConnection('connecting');
    setStatus('Conectando…');
    try {
      const closeCamera = await openWebcam(video, deviceId, () => current() && lose({ kind: 'camera' }));
      if (!current()) {
        closeCamera(); // a newer start/stop happened while the camera was opening
        return;
      }
      sessionCameraRef.current = deviceId;
      // Each cleanup is registered as soon as its resource exists, so a throw below still releases it.
      stopRef.current = [closeCamera];
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
      const client = new SessionClient(
        { type: 'hello', protocol: 1, task_id: taskId, source: 'webcam', debug: true, record: false },
        {
          onMessage: (message) => current() && onMessage(message),
          onAudio: (id, audio) => current() && voiceRef.current.play(id, audio),
          onClose: (reason) => current() && lose({ kind: 'closed', reason, serverError: serverErrorRef.current }),
        },
      );
      stopRef.current = [() => client.close(), closeCamera];
      const stopCapture = startCapture(
        video,
        FPS,
        (jpeg) => client.sendFrame(jpeg),
        () => current() && lose({ kind: 'camera_stalled' }),
      );
      stopRef.current = [stopCapture, () => client.close(), closeCamera];
    } catch (error) {
      if (current()) lose({ kind: 'start', error: String(error) });
    }
  }

  function stop() {
    sessionRef.current += 1;
    stopRef.current.forEach((f) => f());
    stopRef.current = [];
    voiceRef.current.stop();
    setConnection('idle');
    setStatus('Detenido');
  }

  const running = connection === 'connecting' || connection === 'live';

  useEffect(() => {
    runningRef.current = running;
    if (!running && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      refreshRef.current();
    }
  }, [running]);

  return (
    <main className="supervisor">
      <header>
        <h1>Supervisor</h1>
        <span className={`status ${statusError ? 'lost' : connection}`}>{status}</span>
      </header>
      <section className="controls">
        <label>
          Tarea
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={running}>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title_es}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cámara
          <select value={cameraId ?? ''} onChange={(e) => chooseCamera(e.target.value)} disabled={running}>
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Cámara ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void start(cameraId)} disabled={!taskId || running}>
          Empezar
        </button>
        <button onClick={stop} disabled={!running}>
          Detener
        </button>
        <button aria-pressed={showDebug} onClick={() => setShowDebug((v) => !v)}>
          Depurar
        </button>
        {cameraNote && <span className="note">{cameraNote}</span>}
      </section>
      {connection === 'lost' && (
        <div className="lost-banner" role="alert">
          <span>{lostReason}</span>
          <button onClick={() => void reconnect()} disabled={!taskId}>
            Reconectar
          </button>
        </div>
      )}
      <section className="stage">
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ aspectRatio: aspect }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          }}
        />
        <ol className="checklist">
          {task?.steps.map((step) => (
            <li key={step.id} className={statuses[step.id] ?? 'pending'}>
              {step.title_es}
            </li>
          ))}
        </ol>
      </section>
      {issue && (
        <div className="issue" role="alert">
          {issue.text_es}
        </div>
      )}
      <p className="subtitle" aria-live="polite">
        {subtitle}
      </p>
      {showDebug && <pre className="debug">{JSON.stringify(debug, null, 2)}</pre>}
    </main>
  );
}
