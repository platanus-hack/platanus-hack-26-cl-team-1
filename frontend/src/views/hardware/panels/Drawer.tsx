import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** Right-side drawer that slides over the inspector column. */
export function Drawer({ title, icon, onClose, children }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="drw" role="dialog" aria-label={title}>
      <header className="drw-head">
        <span className="drw-icon">{icon}</span>
        <span className="drw-title">{title}</span>
        <button className="drw-close" onClick={onClose} aria-label="Cerrar panel">
          <X size={15} />
        </button>
      </header>
      <div className="drw-body">{children}</div>
    </div>
  );
}
