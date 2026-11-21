import { memo } from 'react';
import { CircleAlert, Info, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import type { AgentStep } from '@/contracts';
import { useProject } from '@/store/project';
import { DecisionCardView } from './DecisionCardView';
import { Markdown } from './Markdown';
import { StepGroup } from './StepGroup';
import { turnInHistory } from './loop';
import type { Turn, TurnItem } from './store';

type Segment =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'steps'; id: string; steps: AgentStep[] }
  | Extract<TurnItem, { kind: 'decision' }>
  | Extract<TurnItem, { kind: 'notice' }>;

/** Consecutive steps are grouped into one collapsible "Pasos" block. */
export function segmentItems(items: TurnItem[]): Segment[] {
  const out: Segment[] = [];
  for (const it of items) {
    if (it.kind === 'step') {
      const last = out[out.length - 1];
      if (last && last.kind === 'steps') last.steps.push(it.step);
      else out.push({ kind: 'steps', id: it.id, steps: [it.step] });
    } else if (it.kind === 'text') {
      if (it.text.trim()) out.push({ kind: 'text', id: it.id, text: it.text });
    } else out.push(it);
  }
  return out;
}

interface Props {
  turn: Turn;
  isLast: boolean;
  busy: boolean;
  canAnswer: (toolUseId: string) => boolean;
  onAnswer: (toolUseId: string, a: { choiceId: string | null; text?: string }) => void;
  onRetry: (turnId: string) => void;
  onUndo: (turnId: string) => void;
}

export const TurnView = memo(function TurnView({ turn, isLast, busy, canAnswer, onAnswer, onRetry, onUndo }: Props) {
  const segments = segmentItems(turn.items);
  const live = turn.status === 'streaming' || turn.status === 'tools' || turn.status === 'waiting-user';
  const lastSeg = segments[segments.length - 1];
  const streamingText = turn.status === 'streaming' && lastSeg?.kind === 'text';
  const thinking = turn.status === 'streaming' && !streamingText;
  // After a reload the undo history is gone: offering the button would only fail.
  const undoable = useProject((s) => turnInHistory(turn.id, s.past));
  const showUndo = turn.changed && !live && (turn.undone || undoable);

  return (
    <article className="agent-turn">
      {turn.userText && (
        <div className="agent-user">
          <div className="agent-user-bubble">{turn.userText}</div>
        </div>
      )}
      <div className="agent-reply">
        <div className="agent-reply-avatar" aria-hidden>
          <Sparkles size={12} strokeWidth={2.4} />
        </div>
        <div className="agent-reply-body">
          {segments.map((seg) => {
            switch (seg.kind) {
              case 'text':
                return <Markdown key={seg.id} text={seg.text} caret={streamingText && seg === lastSeg} />;
              case 'steps':
                return <StepGroup key={seg.id} steps={seg.steps} live={live && seg === lastSeg} />;
              case 'decision':
                return (
                  <DecisionCardView
                    key={seg.id}
                    card={seg.card}
                    enabled={isLast && canAnswer(seg.card.toolUseId)}
                    onAnswer={(a) => onAnswer(seg.card.toolUseId, a)}
                  />
                );
              case 'notice':
                return (
                  <div key={seg.id} className={`agent-notice is-${seg.tone}`}>
                    <Info size={14} />
                    <span>{seg.text}</span>
                  </div>
                );
            }
          })}

          {thinking && (
            <div className="agent-thinking" aria-live="polite">
              <span className="agent-thinking-label">
                {turn.thinking ? 'Pensando' : segments.length ? 'Pensando en el siguiente paso' : 'Pensando'}
                <span className="agent-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              {turn.thinking && <span className="agent-thinking-text">{lastSentence(turn.thinking)}</span>}
            </div>
          )}

          {turn.status === 'stopped' && <div className="agent-stopped">Detuviste al asistente.</div>}

          {turn.status === 'error' && turn.error && (
            <div className="agent-error" role="alert">
              <CircleAlert size={15} className="agent-error-icon" />
              <span className="agent-error-text">{turn.error.message}</span>
              {turn.error.retryable && isLast && (
                <button className="agent-error-retry" onClick={() => onRetry(turn.id)} disabled={busy}>
                  <RotateCcw size={13} /> Reintentar
                </button>
              )}
            </div>
          )}

          {showUndo && (
            <div className="agent-undo">
              {turn.undone ? (
                <span className="agent-undo-done">Cambios del asistente deshechos</span>
              ) : (
                <button className="agent-undo-btn" onClick={() => onUndo(turn.id)} disabled={busy}>
                  <Undo2 size={13} /> Deshacer cambios del asistente
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
});

function lastSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 140) return clean;
  return `…${clean.slice(-139)}`;
}
