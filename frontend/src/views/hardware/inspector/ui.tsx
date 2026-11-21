import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function Section({
  title,
  icon,
  right,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;
  return (
    <section className={`ins-section${isOpen ? '' : ' is-closed'}`}>
      <header className="ins-section-head" onClick={collapsible ? () => setOpen((o) => !o) : undefined} role={collapsible ? 'button' : undefined}>
        {icon && <span className="ins-section-icon">{icon}</span>}
        <span className="ins-section-title">{title}</span>
        {right && <span className="ins-section-right">{right}</span>}
        {collapsible && <ChevronDown size={14} className="ins-section-chevron" />}
      </header>
      {isOpen && <div className="ins-section-body">{children}</div>}
    </section>
  );
}

export function Metric({ label, value, tone, sub, bar }: { label: string; value: ReactNode; tone?: 'accent' | 'warning' | 'danger' | 'blue' | 'violet'; sub?: ReactNode; bar?: number }) {
  return (
    <div className={`ins-metric${tone ? ` is-${tone}` : ''}`}>
      <span className="ins-metric-label">{label}</span>
      <span className="ins-metric-value">{value}</span>
      {sub && <span className="ins-metric-sub">{sub}</span>}
      {bar !== undefined && (
        <span className="ins-metric-bar">
          <span style={{ width: `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`ins-toggle${checked ? ' is-on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="ins-toggle-knob" />
    </button>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="ins-empty-note">{children}</div>;
}
