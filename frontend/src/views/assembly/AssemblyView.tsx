/**
 * <AssemblyView/> — Modo Armado: the webcam watches the real breadboard, the
 * vision server ticks the checklist and talks (Spanish) on errors / next steps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug, Camera, CircleCheck, CircleDot, Circle, Crosshair, LoaderCircle, ScanEye, SkipForward, StepBack,
  TriangleAlert, Video, Volume2, VolumeX, Wifi, WifiOff, X,
} from 'lucide-react';
import type { GuideStep } from '@/contracts';
import { CALIB_HOLES, useAssembly } from '@/assembly/store';
import {
  LABEL_KEYS, recordKey, send, setCapture, setDebug, setMuted, setRecord, startSession, stopSession,
} from '@/assembly/session';
import { useCamera } from '@/assembly/useCamera';
import type { StepStatus } from '@/assembly/protocol';
import { buildWiringGuide } from '@/guide';
import { getNetlist } from '@/store/derived';
import { useProject } from '@/store/project';
import { DebugOverlay } from './DebugOverlay';
import './assembly.css';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <CircleCheck size={18} className="asm-ico done" />;
  if (status === 'error') return <TriangleAlert size={18} className="asm-ico error" />;
  if (status === 'active') return <CircleDot size={18} className="asm-ico active" />;
  return <Circle size={18} className="asm-ico pending" />;
}

function Checklist() {
  const sessionSteps = useAssembly((s) => s.steps);
  const sessionStatus = useAssembly((s) => s.status);
  const current = useAssembly((s) => s.current);
  const running = useAssembly((s) => s.running);
  const project = useProject((s) => s.project);
  // Before the session starts, preview the steps of the current design.
  const preview = useMemo(() => (running ? null : buildWiringGuide(project, getNetlist(project))), [running, project]);
  const steps = preview ?? sessionSteps;
  const status = preview ? {} : sessionStatus;
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // (newer Chrome returns a Promise from scrollIntoView: never return it as the effect cleanup)
    void activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);
  const done = steps.filter((s) => status[String(s.index)] === 'done').length;

  return (
    <aside className="asm-checklist">
      <div className="asm-checklist-head">
        <h2>Pasos de armado</h2>
        <span className="asm-progress mono">
          {done}/{steps.length}
        </span>
      </div>
      <div className="asm-progressbar">
        <div style={{ width: `${steps.length ? (100 * done) / steps.length : 0}%` }} />
      </div>
      <ol className="asm-steps">
        {steps.map((s: GuideStep) => {
          const st = status[String(s.index)] ?? 'pending';
          const isCurrent = s.index === current;
          return (
            <li key={s.id} ref={isCurrent ? activeRef : undefined} className={`asm-step ${st} ${isCurrent ? 'current' : ''}`}>
              <StatusIcon status={st} />
              <div className="asm-step-body">
                <div className="asm-step-title">
                  <span className="mono asm-step-n">{s.index}</span> {s.title}
                </div>
                {isCurrent && (
                  <>
                    <div className="asm-step-detail">{s.detail}</div>
                    {s.tip && <div className="asm-step-tip">{s.tip}</div>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="asm-step-actions">
        <button className="btn sm" disabled={!running || current <= 1} onClick={() => send({ type: 'back_step' })}>
          <StepBack size={14} /> Paso anterior
        </button>
        <button className="btn sm" disabled={!running} onClick={() => send({ type: 'skip_step' })} title="Marcar este paso como hecho">
          <SkipForward size={14} /> Ya lo hice
        </button>
      </div>
    </aside>
  );
}

function Badges() {
  const conn = useAssembly((s) => s.conn);
  const ready = useAssembly((s) => s.ready);
  const calibrated = useAssembly((s) => s.calibrated);
  const markers = useAssembly((s) => s.markers);
  const refined = useAssembly((s) => s.refined);
  const running = useAssembly((s) => s.running);
  if (!running) return null;
  const online = conn === 'open' && ready;
  return (
    <div className="asm-badges">
      <span className={`asm-badge ${online ? 'ok' : conn === 'reconnecting' ? 'warn' : ''}`}>
        {online ? <Wifi size={13} /> : <WifiOff size={13} />}
        {online ? 'Conectado' : conn === 'reconnecting' ? 'Reconectando…' : 'Conectando…'}
      </span>
      <span className={`asm-badge ${calibrated ? 'ok' : 'warn'}`}>
        <Crosshair size={13} />
        {calibrated ? (refined ? 'Calibrado (fino)' : 'Calibrado') : `Buscando marcadores ${markers}/4`}
      </span>
    </div>
  );
}

function Stage({ cam }: { cam: ReturnType<typeof useCamera> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const running = useAssembly((s) => s.running);
  const issue = useAssembly((s) => s.issue);
  const subtitle = useAssembly((s) => s.subtitle);
  const speaking = useAssembly((s) => s.speaking);
  const debug = useAssembly((s) => s.debug);
  const latency = useAssembly((s) => s.latency);
  const paused = useAssembly((s) => s.paused);
  const calibClick = useAssembly((s) => s.calibClick);
  const capture = useAssembly((s) => s.capture);
  const record = useAssembly((s) => s.record);
  const visionUrl = useAssembly((s) => s.visionUrl);
  const setVisionUrl = useAssembly((s) => s.setVisionUrl);
  const steps = useProject((s) => s.project.parts.length);
  const [urlDraft, setUrlDraft] = useState(visionUrl);

  useEffect(() => {
    if (videoRef.current && cam.stream && videoRef.current.srcObject !== cam.stream) {
      videoRef.current.srcObject = cam.stream;
      void videoRef.current.play().catch(() => {});
    }
  }, [cam.stream]);

  const begin = async () => {
    if (urlDraft !== visionUrl) setVisionUrl(urlDraft);
    const stream = cam.stream ?? (await cam.start());
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    await videoRef.current.play().catch(() => {});
    startSession(videoRef.current);
  };

  return (
    <section className="asm-stage">
      <div className="asm-video-box">
        <video ref={videoRef} className="asm-video" muted playsInline />
        <DebugOverlay />
        {issue && running && (
          <div className="asm-issue" role="alert">
            <TriangleAlert size={18} /> {issue.text}
          </div>
        )}
        {paused && running && <div className="asm-paused">{paused}</div>}
        {subtitle && running && (
          <div key={subtitle.at} className={`asm-subtitle ${subtitle.priority} ${speaking ? 'speaking' : ''}`}>
            <Volume2 size={15} /> {subtitle.text}
          </div>
        )}
        {calibClick !== null && (
          <div className="asm-calib-hint">
            Haz clic en el hueco <b className="mono">{CALIB_HOLES[calibClick]}</b> ({calibClick + 1}/4)
          </div>
        )}
        {debug && running && (
          <div className="asm-latency mono">
            {Object.entries(latency)
              .map(([k, v]) => `${k} ${Math.round(v)} ms`)
              .join(' · ')}
          </div>
        )}
        {!running && (
          <div className="asm-start">
            <ScanEye size={34} className="asm-start-ico" />
            <h2>Modo Armado</h2>
            <p>
              Apunta la cámara a la protoboard (con el tapete de marcadores). Te voy marcando cada paso y te aviso en voz alta si algo
              quedó mal.
            </p>
            {steps === 0 && <p className="asm-warn">Tu diseño está vacío: carga un ejemplo o arma el circuito primero.</p>}
            <label className="asm-field">
              <span>Servidor de visión</span>
              <input
                className="mono"
                value={urlDraft}
                placeholder="wss://….trycloudflare.com/ws/session"
                onChange={(e) => setUrlDraft(e.target.value)}
                spellCheck={false}
              />
            </label>
            {cam.error && <p className="asm-warn">{cam.error}</p>}
            <button className="btn primary" disabled={!urlDraft.trim()} onClick={() => void begin()}>
              <Video size={16} /> Empezar
            </button>
          </div>
        )}
      </div>
      {debug && running && (
        <div className="asm-debugbar">
          <button className="btn sm" onClick={() => useAssembly.getState().patch({ calibClick: 0 })}>
            <Crosshair size={14} /> Calibrar huecos (4 clics)
          </button>
          <button className={`btn sm ${capture.on ? 'danger' : ''}`} onClick={() => setCapture(!capture.on)}>
            <Camera size={14} /> {capture.on ? `Detener fotos (${capture.saved})` : 'Grabar fotos'}
          </button>
          <button className={`btn sm ${record ? 'danger' : ''}`} onClick={() => setRecord(!record)} title="Sesión de dataset para el VLM">
            <CircleDot size={14} /> {record ? 'Detener sesión de dataset' : 'Grabar sesión (dataset)'}
          </button>
          <span className="asm-debug-note">Tecla D: ocultar el modo debug</span>
        </div>
      )}
      {debug && running && record && (
        <div className="asm-debugbar asm-keys mono">
          {LABEL_KEYS.map((l) => (
            <span key={l.key}>
              <kbd>{l.key}</kbd> {l.label}
            </span>
          ))}
          <span>
            <kbd>0</kbd> corregido
          </span>
          <span>
            <kbd>N</kbd> paso hecho
          </span>
        </div>
      )}
    </section>
  );
}

export function AssemblyView() {
  const cam = useCamera();
  const running = useAssembly((s) => s.running);
  const muted = useAssembly((s) => s.muted);
  const debug = useAssembly((s) => s.debug);
  const projectName = useProject((s) => s.project.name);
  const conn = useAssembly((s) => s.conn);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (recordKey(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'd' || e.key === 'D') setDebug(!useAssembly.getState().debug);
      if (e.key === 'Escape') useAssembly.getState().patch({ calibClick: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => stopSession(), []);

  const exit = () => {
    stopSession();
    cam.stop();
    useAssembly.getState().setOpen(false);
  };

  return (
    <div className="asm">
      <header className="asm-bar">
        <div className="asm-title">
          <ScanEye size={18} /> Modo Armado <span className="asm-project">· {projectName}</span>
        </div>
        <Badges />
        <div className="asm-bar-right">
          {conn === 'connecting' && running && <LoaderCircle size={16} className="spin" />}
          {cam.devices.length > 1 && (
            <select className="asm-select" value={cam.deviceId} onChange={(e) => cam.setDeviceId(e.target.value)} aria-label="Cámara">
              <option value="">Cámara por defecto</option>
              {cam.devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Cámara ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          <button className={`btn icon ${debug ? 'active-toggle' : ''}`} onClick={() => setDebug(!debug)} title="Modo debug (tecla D)">
            <Bug size={16} />
          </button>
          <button className="btn icon" onClick={() => setMuted(!muted)} title={muted ? 'Activar la voz' : 'Silenciar la voz'}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className="btn" onClick={exit}>
            <X size={15} /> Salir
          </button>
        </div>
      </header>
      <div className="asm-body">
        <Stage cam={cam} />
        <Checklist />
      </div>
    </div>
  );
}
