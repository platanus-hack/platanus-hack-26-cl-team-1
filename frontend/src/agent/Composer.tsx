import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface Props {
  busy: boolean;
  /** An ask_user card is open: typed text answers it. */
  answering: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_HEIGHT = 168;

/** Auto-growing textarea: Enter sends, Shift+Enter adds a line, Stop while streaming. */
export function Composer({ busy, answering, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const canType = !busy || answering;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    if (answering) ref.current?.focus();
  }, [answering]);

  const send = () => {
    const t = text.trim();
    if (!t || !canType) return;
    onSend(t);
    setText('');
  };

  const showStop = busy && !answering;

  return (
    <div className="agent-composer">
      <div className={`agent-composer-box ${answering ? 'is-answering' : ''}`}>
        <textarea
          ref={ref}
          className="agent-composer-input"
          rows={1}
          value={text}
          disabled={!canType}
          placeholder={answering ? 'Elige una opción o escribe tu respuesta…' : busy ? 'El asistente está trabajando…' : 'Pregúntame lo que quieras…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Mensaje para el asistente"
        />
        {showStop ? (
          <button className="agent-composer-btn is-stop" onClick={onStop} title="Detener" aria-label="Detener al asistente">
            <Square size={11} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button className="agent-composer-btn" onClick={send} disabled={!text.trim() || !canType} title="Enviar (Enter)" aria-label="Enviar">
            <ArrowUp size={16} strokeWidth={2.6} />
          </button>
        )}
      </div>
      <div className="agent-composer-hint">
        <span>
          <kbd>Enter</kbd> enviar · <kbd>Shift</kbd>+<kbd>Enter</kbd> nueva línea
        </span>
      </div>
    </div>
  );
}
