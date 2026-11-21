import { useState } from 'react';
import { ArrowUp, Check, MessageCircleQuestion } from 'lucide-react';
import type { DecisionCard } from '@/contracts';

interface Props {
  card: DecisionCard;
  /** False when the card can no longer be answered (agent stopped, newer messages). */
  enabled: boolean;
  onAnswer: (answer: { choiceId: string | null; text?: string }) => void;
}

/** Question + option buttons (+ optional free text). Disabled once answered. */
export function DecisionCardView({ card, enabled, onAnswer }: Props) {
  const [text, setText] = useState('');
  const answered = card.answered;
  const locked = !!answered || !enabled;

  const submitText = () => {
    const t = text.trim();
    if (!t || locked) return;
    onAnswer({ choiceId: null, text: t });
  };

  return (
    <div className={`agent-card ${answered ? 'is-answered' : ''} ${!answered && !enabled ? 'is-stale' : ''}`}>
      <div className="agent-card-q">
        <MessageCircleQuestion size={15} className="agent-card-q-icon" />
        <span>{card.question}</span>
      </div>
      <div className="agent-card-options" role="group" aria-label={card.question}>
        {card.options.map((o) => {
          const chosen = answered?.choiceId === o.id;
          return (
            <button
              key={o.id}
              className={`agent-card-option ${chosen ? 'is-chosen' : ''}`}
              disabled={locked}
              onClick={() => onAnswer({ choiceId: o.id })}
            >
              <span className="agent-card-option-text">
                <span className="agent-card-option-label">{o.label}</span>
                {o.description && <span className="agent-card-option-desc">{o.description}</span>}
              </span>
              {chosen && <Check size={15} strokeWidth={2.6} className="agent-card-check" />}
            </button>
          );
        })}
      </div>
      {card.allowFreeText && !answered && enabled && (
        <form
          className="agent-card-free"
          onSubmit={(e) => {
            e.preventDefault();
            submitText();
          }}
        >
          <input className="agent-card-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="O escribe tu respuesta…" />
          <button className="agent-card-send" type="submit" disabled={!text.trim()} aria-label="Enviar respuesta">
            <ArrowUp size={14} strokeWidth={2.6} />
          </button>
        </form>
      )}
      {answered?.text && (
        <div className="agent-card-answer">
          <span className="agent-card-answer-label">Tu respuesta:</span> {answered.text}
        </div>
      )}
      {!answered && !enabled && <div className="agent-card-stale">Pregunta sin responder</div>}
    </div>
  );
}
