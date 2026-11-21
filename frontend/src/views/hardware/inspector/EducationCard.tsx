import { BookOpen, Lightbulb, TriangleAlert } from 'lucide-react';
import type { PartDef } from '@/contracts';
import { Section } from './ui';

export function EducationCard({ def }: { def: PartDef }) {
  const ed = def.education;
  if (!ed) return null;
  return (
    <Section title="Aprende" icon={<BookOpen size={13} />}>
      <div className="ins-edu">
        <p className="ins-edu-summary">{ed.summary}</p>
        {ed.howItWorks && (
          <details className="ins-edu-how">
            <summary>¿Cómo funciona?</summary>
            <p>{ed.howItWorks}</p>
          </details>
        )}
        {ed.tips?.length > 0 && (
          <ul className="ins-edu-list">
            {ed.tips.map((t, i) => (
              <li key={i} className="is-tip">
                <Lightbulb size={13} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
        {ed.warnings && ed.warnings.length > 0 && (
          <ul className="ins-edu-list">
            {ed.warnings.map((t, i) => (
              <li key={i} className="is-warning">
                <TriangleAlert size={13} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
