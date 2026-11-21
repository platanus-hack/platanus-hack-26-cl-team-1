import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Code2, Cpu, OctagonAlert } from 'lucide-react';
import clsx from 'clsx';
import type { CodegenResult } from '@/contracts';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { programContext, type ProgramContext } from '@/program/context';
import { getProgramErrors, getProgramIR } from '@/program/blocks';
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

function IssueList({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  const errors = issues.filter((i) => i.kind === 'error').length;
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
      <button type="button" className="sw-issues-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {errors ? <OctagonAlert size={14} /> : <AlertTriangle size={14} />}
        <span>
          {issues.length === 1 ? '1 aviso' : `${issues.length} avisos`}
          {errors > 0 && <em> · {errors === 1 ? '1 problema' : `${errors} problemas`}</em>}
        </span>
        <ChevronDown size={14} className="sw-issues-chevron" />
      </button>
      {open && (
        <ul className="sw-issues-list">
          {issues.map((issue, i) => (
            <li key={i} className={`is-${issue.kind}`}>
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
  const programErrors = useMemo(() => getProgramErrors(project), [project]);
  const selectedIds = useSoftwareView((s) => s.selectedIds);
  const activeBlockId = useSim((s) => (s.program === 'stopped' ? null : s.activeBlockId));

  const selectedLines = useMemo(() => linesForBlocks(result.lineMap, new Set(selectedIds)), [result.lineMap, selectedIds]);
  const activeLines = useMemo(() => linesForBlocks(result.lineMap, new Set(activeBlockId ? [activeBlockId] : [])), [result.lineMap, activeBlockId]);

  const issues = useMemo<Issue[]>(
    () => [
      ...programErrors.map((message) => ({ kind: 'error' as const, message })),
      ...result.warnings.map((w) => ({ kind: 'warning' as const, message: w.message, blockId: w.blockId })),
    ],
    [programErrors, result.warnings],
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
      <CodeViewer code={result.code} lineMap={result.lineMap} selectedLines={selectedLines} activeLines={activeLines} onLineClick={(_, id) => focusBlock(id)} />
      <div className="sw-compile">
        <CompilePanel />
      </div>
    </div>
  );
}
