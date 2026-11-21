/** Presentational pieces of <CompilePanel/>. */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, CircleAlert, CircleCheck, Clock, Hammer, Puzzle, TriangleAlert, Usb } from 'lucide-react';
import type { CompileDiagnostic } from '@/contracts';
import { codeLine, formatSeconds, usageLevel, usagePercent, usageText, wholePercent } from './format';

/** Re-renders every `tickMs` while `active` and returns ms since `startedAt`. */
export function useElapsed(startedAt: number | null, active: boolean, tickMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [active, tickMs]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}

export function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = usagePercent(used, max);
  const level = usageLevel(pct);
  return (
    <div className="flash-usage">
      <div className="flash-usage-head">
        <span className="flash-usage-label">{label}</span>
        <span className={clsx('flash-usage-pct', `is-${level}`)}>{max ? `${wholePercent(used, max)} %` : '—'}</span>
      </div>
      <div className="flash-usage-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={clsx('flash-usage-fill', `is-${level}`)} style={{ width: `${Math.max(pct, used > 0 ? 1.5 : 0)}%` }} />
      </div>
      <div className="flash-usage-text">{usageText(used, max)}</div>
    </div>
  );
}

export function EmptyState({ boardName }: { boardName: string | null }) {
  const steps = [
    { icon: Hammer, title: 'Compilar', text: 'Revisamos tu programa y lo traducimos al idioma del microcontrolador.' },
    { icon: Usb, title: 'Cargar', text: boardName ? `Conecta tu ${boardName} por USB y envíale el programa.` : 'Conecta tu placa por USB y envíale el programa.' },
  ];
  return (
    <ol className="flash-steps">
      {steps.map((s, i) => (
        <li key={s.title} className="flash-step">
          <span className="flash-step-icon">
            <s.icon size={15} strokeWidth={2.2} />
          </span>
          <span className="flash-step-body">
            <span className="flash-step-title">
              <span className="flash-step-num">{i + 1}</span>
              {s.title}
            </span>
            <span className="flash-step-text">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function focusBlock(blockId: string): void {
  window.dispatchEvent(new CustomEvent('cv:focus-block', { detail: { blockId } }));
}

export function DiagnosticsList({ diagnostics, code }: { diagnostics: CompileDiagnostic[]; code: string | null }) {
  if (diagnostics.length === 0) return null;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return (
    <section className="flash-diags" aria-label="Mensajes del compilador">
      <header className="flash-section-title">
        {errors > 0 && <span className="flash-count is-error">{errors === 1 ? '1 error' : `${errors} errores`}</span>}
        {warnings > 0 && <span className="flash-count is-warning">{warnings === 1 ? '1 advertencia' : `${warnings} advertencias`}</span>}
      </header>
      <ul className="flash-diag-list">
        {diagnostics.map((d, i) => {
          const snippet = codeLine(code, d.line);
          const Icon = d.severity === 'error' ? CircleAlert : TriangleAlert;
          const content = (
            <>
              <Icon size={15} className="flash-diag-icon" />
              <span className="flash-diag-main">
                <span className="flash-diag-meta">
                  <span className="flash-diag-line">Línea {d.line}{d.column ? `:${d.column}` : ''}</span>
                  {d.blockId && (
                    <span className="flash-diag-goto">
                      <Puzzle size={12} /> Ver bloque <ChevronRight size={12} />
                    </span>
                  )}
                </span>
                <span className="flash-diag-msg">{d.message}</span>
                {snippet && <code className="flash-diag-code">{snippet.trim()}</code>}
              </span>
            </>
          );
          return (
            <li key={`${d.line}:${d.column ?? 0}:${i}`}>
              {d.blockId ? (
                <button type="button" className={clsx('flash-diag', `is-${d.severity}`, 'is-link')} onClick={() => focusBlock(d.blockId!)} title="Mostrar el bloque que generó esta línea">
                  {content}
                </button>
              ) : (
                <div className={clsx('flash-diag', `is-${d.severity}`)}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StatusChip({ status, busy, stale, elapsedMs, durationMs }: {
  status: 'idle' | 'queued' | 'running' | 'success' | 'error';
  busy: boolean;
  stale: boolean;
  elapsedMs: number;
  durationMs?: number;
}) {
  if (busy) {
    return (
      <span className="chip info flash-chip">
        <span className="flash-pulse" />
        {status === 'running' ? 'Compilando' : 'En cola'}
        <span className="flash-chip-time">{formatSeconds(elapsedMs)}</span>
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className={clsx('chip flash-chip', stale ? 'warn' : 'ok')}>
        {stale ? <Clock size={12} /> : <CircleCheck size={12} />}
        {stale ? 'Desactualizado' : 'Compilado'}
        {durationMs !== undefined && !stale && <span className="flash-chip-time">{formatSeconds(durationMs)}</span>}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className={clsx('chip flash-chip', stale ? 'warn' : 'err')}>
        <CircleAlert size={12} />
        {stale ? 'Desactualizado' : 'Con errores'}
      </span>
    );
  }
  return <span className="chip flash-chip">Sin compilar</span>;
}
