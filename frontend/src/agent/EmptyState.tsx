import { CircuitBoard, HelpCircle, Lightbulb, Sparkles, TrafficCone, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

export const SUGGESTIONS: Array<{ text: string; icon: ComponentType<{ size?: number }> }> = [
  { text: 'Quiero hacer parpadear un LED', icon: Lightbulb },
  { text: '¿Qué es una resistencia?', icon: HelpCircle },
  { text: 'Arma un semáforo con el Arduino', icon: TrafficCone },
  { text: 'Explícame mi circuito', icon: CircuitBoard },
  { text: '¿Por qué no enciende mi LED?', icon: Zap },
];

export function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <div className="agent-empty">
      <div className="agent-empty-hero">
        <div className="agent-empty-orb" aria-hidden>
          <Sparkles size={24} strokeWidth={2} />
        </div>
        <h2 className="agent-empty-title">¡Hola! Soy tu asistente</h2>
        <p className="agent-empty-sub">
          Te ayudo a armar circuitos en la protoboard, entender por dónde pasa la corriente y programar tu placa con bloques.
        </p>
      </div>
      <div className="agent-empty-label">Prueba con</div>
      <div className="agent-chips">
        {SUGGESTIONS.map(({ text, icon: Icon }) => (
          <button key={text} className="agent-chip" onClick={() => onPick(text)} disabled={disabled}>
            <span className="agent-chip-icon">
              <Icon size={14} />
            </span>
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
