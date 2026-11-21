import { useEffect, useState } from 'react';
import { KeyRound, SquarePen, Sparkles } from 'lucide-react';

interface ModelInfo {
  label: string;
  configured: boolean | null;
}

let cached: Promise<ModelInfo> | null = null;

/** "claude-opus-5-5" → "Opus 5.5". */
export function prettyModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] && m[3].length <= 2 ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

function loadModelInfo(): Promise<ModelInfo> {
  cached ??= fetch('/api/health')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { model?: string; agent?: boolean | null }) => ({
      label: j.model ? prettyModel(j.model) : 'Claude',
      configured: j.agent === true ? true : j.agent === null || j.agent === false ? false : null,
    }))
    .catch(() => {
      cached = null; // retry on next mount
      return { label: 'Claude', configured: null };
    });
  return cached;
}

export type AgentActivity = 'idle' | 'thinking' | 'working' | 'waiting';

const STATUS_ES: Record<AgentActivity, string> = {
  idle: 'Listo para ayudarte',
  thinking: 'Pensando…',
  working: 'Trabajando en tu proyecto…',
  waiting: 'Esperando tu respuesta',
};

export function AgentHeader({ activity, onNew, canReset }: { activity: AgentActivity; onNew: () => void; canReset: boolean }) {
  const [info, setInfo] = useState<ModelInfo>({ label: 'Claude', configured: null });
  useEffect(() => {
    let alive = true;
    void loadModelInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="agent-header">
      <div className={`agent-avatar ${activity === 'thinking' || activity === 'working' ? 'is-busy' : ''}`} aria-hidden>
        <Sparkles size={16} strokeWidth={2.2} />
      </div>
      <div className="agent-header-text">
        <div className="agent-header-title">Asistente</div>
        <div className={`agent-header-status is-${activity}`}>
          <span className="agent-status-dot" />
          {STATUS_ES[activity]}
        </div>
      </div>
      {info.configured === false ? (
        <span className="agent-model-chip is-warn" title="Falta ANTHROPIC_API_KEY en backend/.env">
          <KeyRound size={11} /> Sin clave
        </span>
      ) : (
        <span className="agent-model-chip" title="Modelo de Claude">
          {info.label}
        </span>
      )}
      <button className="agent-icon-btn" onClick={onNew} disabled={!canReset} title="Nueva conversación" aria-label="Nueva conversación">
        <SquarePen size={15} />
      </button>
    </header>
  );
}
