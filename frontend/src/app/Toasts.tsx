import { useUI } from '@/store/ui';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';

const ICON = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: XCircle };

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const I = ICON[t.kind];
        return (
          <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            <I size={16} />
            <span>{t.text}</span>
          </button>
        );
      })}
    </div>
  );
}
