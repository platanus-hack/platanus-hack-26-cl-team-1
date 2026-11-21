import { useState } from 'react';
import { Check, ChevronDown, CircleAlert, Hand, LoaderCircle } from 'lucide-react';
import type { AgentStep } from '@/contracts';

function StepIcon({ status, size = 13 }: { status: AgentStep['status']; size?: number }) {
  switch (status) {
    case 'done':
      return <Check size={size} strokeWidth={2.6} />;
    case 'error':
      return <CircleAlert size={size} strokeWidth={2.2} />;
    case 'waiting-user':
      return <Hand size={size - 1} strokeWidth={2.2} />;
    case 'running':
      return <LoaderCircle size={size} strokeWidth={2.4} className="agent-spin" />;
    default:
      return <span className="agent-step-dot" />;
  }
}

const isActive = (s: AgentStep) => s.status === 'running' || s.status === 'pending' || s.status === 'waiting-user';

function badgeClass(status: AgentStep['status']): string {
  if (status === 'done') return 'is-done';
  if (status === 'error' || status === 'waiting-user') return 'is-error';
  return 'is-active';
}

/** Collapsible list of tool steps ("Pasos") with live status icons. */
export function StepGroup({ steps, live }: { steps: AgentStep[]; live: boolean }) {
  const active = steps.some(isActive);
  const errors = steps.filter((s) => s.status === 'error').length;
  const done = steps.filter((s) => s.status === 'done').length;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (active || live);
  const current = steps.find((s) => s.status === 'running' || s.status === 'waiting-user') ?? steps.find(isActive) ?? steps[steps.length - 1];
  const headStatus: AgentStep['status'] = active ? current.status : errors ? 'error' : 'done';

  // A single step is a compact, non-collapsible row.
  if (steps.length === 1) {
    const s = steps[0];
    return (
      <div className={`agent-steps is-single ${active ? 'is-active' : ''}`}>
        <div className={`agent-step-row is-${s.status}`}>
          <span className={`agent-steps-badge ${badgeClass(s.status)}`}>
            <StepIcon status={s.status} size={12} />
          </span>
          <span className="agent-step-body">
            <span className="agent-steps-title">{s.title}</span>
            {s.detail && <span className="agent-step-detail">{s.detail}</span>}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`agent-steps ${active ? 'is-active' : ''}`}>
      <button className="agent-steps-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className={`agent-steps-badge ${badgeClass(headStatus)}`}>
          <StepIcon status={headStatus} size={12} />
        </span>
        <span className="agent-steps-title">{active ? current.title : `${steps.length} pasos`}</span>
        <span className="agent-steps-meta">
          {active ? `${done}/${steps.length}` : errors > 0 ? `${done} listos · ${errors} con aviso` : 'listo'}
        </span>
        <ChevronDown size={14} className={`agent-steps-chevron ${expanded ? 'is-open' : ''}`} />
      </button>
      {expanded && (
        <ol className="agent-steps-list">
          {steps.map((s) => (
            <li key={s.id} className={`agent-step is-${s.status}`}>
              <span className="agent-step-icon">
                <StepIcon status={s.status} />
              </span>
              <span className="agent-step-body">
                <span className="agent-step-title">{s.title}</span>
                {s.detail && <span className="agent-step-detail">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
