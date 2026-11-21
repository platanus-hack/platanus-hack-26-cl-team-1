import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Code2, Cpu, OctagonAlert } from 'lucide-react';
import clsx from 'clsx';
import type { CodegenResult } from '@/contracts';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { programContext, type ProgramContext } from '@/program/context';
import { getProgramIR, getProgramIssues } from '@/program/blocks';
import { generateCode } from '@/program/codegen';
import { CompilePanel } from '@/flash/CompilePanel';
import { CodeViewer } from './CodeViewer';
import { linesForBlocks } from './lines';
import { focusBlock, useSoftwareView } from './state';

interface Issue {
  kind: 'error' | 'warning';
  message: string;
  blockId?: string;
}

function safeGenerate(project: Parameters<typeof getProgramIR>[0], ctx: ProgramContext): CodegenResult {
  try {
    return generateCode(getProgramIR(project), ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { code: `// No se pudo generar el código:\n// ${msg}\n`, lineMap: {}, warnings: [{ message: `Error del generador de código: ${msg}` }] };
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

function IssueList({ issues }: { issues: Issue[] }) {
  const open = useSoftwareView((s) => s.issuesOpen);
  const setOpen = useSoftwareView((s) => s.setIssuesOpen);
  const errors = issues.filter((i) => i.kind === 'error').length;
  const warnings = issues.length - errors;
  if (issues.length === 0) {
    return (
      <div className="sw-issues is-clean">
        <CheckCircle2 size={14} />
        <span>Sin avisos: el programa se ve bien</span>
      </div>
    );
  }
  return (
    <div className={clsx('sw-issues', errors ? 'has-errors' : 'has-warnings', open && 'is-open')}>
      <button type="button" className="sw-issues-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {errors ? <OctagonAlert size={14} /> : <AlertTriangle size={14} />}
        <span className="sw-issues-count">
          {errors > 0 && plural(errors, 'problema', 'problemas')}
          {errors > 0 && warnings > 0 && ' · '}
          {warnings > 0 && plural(warnings, 'aviso', 'avisos')}
        </span>
        {/* Collapsed: the first issue stays readable so a problem is never hidden behind the chevron. */}
        {!open && <span className="sw-issues-peek">{issues[0].message}</span>}
        <ChevronDown size={14} className="sw-issues-chevron" />
      </button>
      {open && (
        <ul className="sw-issues-list">
          {issues.map((issue, i) => (
            <li key={`${issue.kind}:${issue.blockId ?? ''}:${issue.message}:${i}`} className={`is-${issue.kind}`}>
              {issue.blockId ? (
                <button type="button" onClick={() => focusBlock(issue.blockId!)} title="Ver el bloque">
                  {issue.message}
                </button>
              ) : (
                <span>{issue.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CodePanel() {
  const project = useProject((s) => s.project);
  const ctx = useMemo(() => programContext(project), [project]);
  const result = useMemo(() => safeGenerate(project, ctx), [project, ctx]);
  const programIssues = useMemo(() => getProgramIssues(project), [project]);
  const selectedIds = useSoftwareView((s) => s.selectedIds);
  const activeBlockId = useSim((s) => (s.program === 'stopped' ? null : s.activeBlockId));

  const following = useSim((s) => s.program === 'running');
  const implicitLines = useMemo(() => new Set(result.implicitLines ?? []), [result.implicitLines]);

  const selectedLines = useMemo(() => linesForBlocks(result.lineMap, new Set(selectedIds)), [result.lineMap, selectedIds]);
  // The auto-added pinMode/attach lines in setup() map to the first block using the part, but
  // they do not run on every loop pass: never light them up as the running line.
  const activeLines = useMemo(() => {
    const lines = linesForBlocks(result.lineMap, new Set(activeBlockId ? [activeBlockId] : []));
    for (const ln of implicitLines) lines.delete(ln);
    return lines;
  }, [result.lineMap, activeBlockId, implicitLines]);

  const issues = useMemo<Issue[]>(
    () => [
      ...programIssues.map((i) => ({ kind: 'error' as const, message: i.message, blockId: i.blockId })),
      ...result.warnings.map((w) => ({ kind: 'warning' as const, message: w.message, blockId: w.blockId })),
    ],
    [programIssues, result.warnings],
  );

  const board = ctx.board;

  return (
    <div className="sw-panel">
      <header className="sw-panel-head">
        <div className="sw-title">
          <Code2 size={15} />
          <span>Código Arduino</span>
        </div>
        {board && (
          <span className="sw-board-chip" title={board.description}>
            <Cpu size={13} />
            <span>{board.name}</span>
            <span className="sw-board-fqbn">{board.fqbn}</span>
          </span>
        )}
      </header>
      <IssueList issues={issues} />
      <CodeViewer
        code={result.code}
        lineMap={result.lineMap}
        selectedLines={selectedLines}
        activeLines={activeLines}
        implicitLines={implicitLines}
        following={following}
        onLineClick={(_, id) => focusBlock(id)}
      />
      <div className="sw-compile">
        <CompilePanel />
      </div>
    </div>
  );
}
