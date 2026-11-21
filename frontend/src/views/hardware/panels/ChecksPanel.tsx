import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, Info, OctagonX, TriangleAlert, Wrench } from 'lucide-react';
import type { CheckIssue } from '@/contracts';
import { getIssues } from '@/store/derived';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { issuesSignature, sortIssues } from '../logic/issues';

/**
 * Computes circuit + program checks ONCE per sim tick and publishes them to
 * the local store (toolbar badge, canvas badges, panel) only when they change.
 */
export function IssuesBridge() {
  const project = useProject((s) => s.project);
  const result = useSim((s) => s.result);
  useEffect(() => {
    let list: CheckIssue[] = [];
    try {
      list = getIssues(project);
    } catch {
      list = [];
    }
    const hw = useHW.getState();
    if (issuesSignature(list) !== issuesSignature(hw.issues)) hw.set({ issues: list });
  }, [project, result]);
  return null;
}

const ICON = { error: OctagonX, warning: TriangleAlert, info: Info };

function IssueCard({ issue }: { issue: CheckIssue }) {
  const [open, setOpen] = useState(issue.severity === 'error');
  const I = ICON[issue.severity];
  const focus = () => {
    const ui = useUI.getState();
    ui.select({ parts: issue.parts, wires: issue.wires ?? [] });
    const targets = [...issue.parts, ...(issue.wires ?? [])];
    if (targets.length) ui.setHighlight(targets, issue.title);
  };
  return (
    <li className={`chk-card is-${issue.severity}`}>
      <button className="chk-card-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <I size={15} className="chk-card-icon" />
        <span className="chk-card-title">{issue.title}</span>
      </button>
      {open && (
        <div className="chk-card-body">
          <p>{issue.message}</p>
          {issue.fix && (
            <p className="chk-fix">
              <Wrench size={13} />
              <span>{issue.fix}</span>
            </p>
          )}
          {(issue.parts.length > 0 || (issue.wires?.length ?? 0) > 0) && (
            <button className="btn sm" onClick={focus}>
              Mostrar en el circuito
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ChecksPanel() {
  const issues = useHW((s) => s.issues);
  const sorted = useMemo(() => sortIssues(issues), [issues]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return (
    <div className="chk">
      <div className="chk-summary">
        <span className={`chk-pill ${errors ? 'is-error' : ''}`}>
          <OctagonX size={13} /> {errors} error{errors === 1 ? '' : 'es'}
        </span>
        <span className={`chk-pill ${warnings ? 'is-warning' : ''}`}>
          <TriangleAlert size={13} /> {warnings} aviso{warnings === 1 ? '' : 's'}
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="chk-empty">
          <CircleCheck size={36} />
          <strong>Todo en orden</strong>
          <p>No encontramos problemas en tu circuito ni en tu programa. ¡Sigue construyendo!</p>
        </div>
      ) : (
        <ul className="chk-list">
          {sorted.map((i) => (
            <IssueCard key={i.id} issue={i} />
          ))}
        </ul>
      )}
    </div>
  );
}
