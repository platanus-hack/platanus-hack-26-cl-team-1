/**
 * <CompilePanel/> — self-contained "Compilar y cargar" panel for the software view.
 * Reads the shared last compile (useCompile), so a compile started by the agent shows up here too.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CircleAlert, CircleCheck, Cpu, Download, Hammer, LoaderCircle, Terminal, Usb, X, Zap } from 'lucide-react';
import type { BoardProfile, CompileResult } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import { flushPendingEdits, useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { compileSketch } from './compile';
import { DiagnosticsList, EmptyState, StatusChip, UsageBar, useElapsed } from './CompileParts';
import { FlashError } from './errors';
import { downloadArtifactAsync, flashArtifact, webSerialSupported } from './flashing';
import { artifactExt, codeFingerprint, formatSeconds, logSummary } from './format';
import { projectSketch } from './project';
import { useCompile, useFlash } from './store';
import './compile.css';

function safeProfile(id: string | null | undefined): BoardProfile | null {
  if (!id) return null;
  try {
    return getBoardProfile(id as BoardProfile['id']);
  } catch {
    return null;
  }
}

/**
 * The user's compile is owned by the module, not by the panel: the panel unmounts whenever the
 * student switches to the circuit view, and that must not cancel a compile (it is bounded by the
 * client deadline and publishes to useCompile, which the remounted panel reads). ⨯ still cancels it.
 */
let userCompile: AbortController | null = null;

export function CompilePanel() {
  const project = useProject((s) => s.project);
  const sketch = useMemo(() => projectSketch(project), [project]);
  const { result, code: compiledCode, busy, startedAt } = useCompile();
  const flash = useFlash();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const board = sketch.board;
  const profile = safeProfile(board);
  const hasCode = 'code' in sketch;
  const elapsed = useElapsed(startedAt, busy);

  // Comment-only changes (project name, the pin list in the header) build the same binary.
  const stale = !!result && !busy && (!hasCode || codeFingerprint(compiledCode) !== codeFingerprint(sketch.code) || result.board !== board);
  const boardMismatch = !!result && !!board && result.board !== board;
  const resultProfile = safeProfile(result?.board);
  const status: 'idle' | CompileResult['status'] = result ? result.status : 'idle';
  const serialOk = webSerialSupported();
  const isFlashing = flash.phase === 'flashing';
  const flashForThis = !!result && flash.jobId === result.jobId;
  // A failed build whose sketch diagnostics are only warnings (the error was in a library or the
  // linker) still needs the "No se pudo compilar" summary, or the student only sees a warning.
  const noErrorDiag = !!result && !result.diagnostics.some((d) => d.severity === 'error');

  useEffect(() => setDownloadError(null), [result?.jobId]);

  const onCompile = async () => {
    if (busy) return;
    // A block edit made a moment ago may still be waiting in the editor's debounce: save it and
    // compile the program as it is now, not as it was at the last render.
    flushPendingEdits();
    const current = projectSketch(useProject.getState().project);
    if (!('code' in current)) return;
    userCompile?.abort();
    const ctrl = new AbortController();
    userCompile = ctrl;
    setLogOpen(false);
    useFlash.setState({ phase: 'idle', fraction: 0, message: '', error: null, jobId: null });
    const r = await compileSketch(current.board, current.code, { signal: ctrl.signal, lineMap: current.lineMap });
    if (userCompile === ctrl) userCompile = null;
    // Nothing line-mapped to show: open the raw log so the student sees what happened.
    if (r.status === 'error' && !r.diagnostics.some((d) => d.severity === 'error') && r.log.length > 200) setLogOpen(true);
  };

  const onCancel = () => userCompile?.abort();

  const onDownload = async () => {
    if (!result) return;
    setDownloadError(null);
    try {
      await downloadArtifactAsync(result);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  };

  const onFlash = async () => {
    if (!result || !board) return;
    try {
      await flashArtifact(result, board);
      useUI.getState().toast('¡Programa cargado en la placa!', 'success');
    } catch (err) {
      if (err instanceof FlashError && err.code !== 'cancelled') useUI.getState().toast(err.message, 'error');
    }
  };

  const goToHardware = () => useUI.getState().showView('hardware');

  // An outdated build (the program or board changed since) must not reach the board.
  const canFlash = !!result && result.status === 'success' && !!result.artifactUrl && serialOk && !isFlashing && !busy && !boardMismatch && !stale;
  const flashTitle = !serialOk
    ? 'La carga por USB requiere Google Chrome o Microsoft Edge (Web Serial).'
    : boardMismatch
      ? 'Este binario se compiló para otra placa: vuelve a compilar.'
      : stale
        ? 'El programa cambió desde la última compilación: vuelve a compilar antes de cargarlo.'
        : `Conecta tu ${resultProfile?.name ?? 'placa'} por USB y elige su puerto.`;

  return (
    <div className="flash-panel">
      <header className="flash-header">
        <div className="flash-title">
          <span className="flash-title-icon">
            <Zap size={14} strokeWidth={2.4} />
          </span>
          Compilar y cargar
        </div>
        {profile ? (
          <span className="flash-board" title={profile.fqbn}>
            <Cpu size={13} /> {profile.name}
          </span>
        ) : (
          <span className="flash-board is-empty">Sin placa</span>
        )}
      </header>

      <div className="flash-body">
        {!board ? (
          <div className="flash-notice">
            <Cpu size={18} />
            <div>
              <strong>Falta una placa</strong>
              <p>Agrega un Arduino Uno o un ESP32-C6 al circuito: el programa se compila para esa placa.</p>
              <button type="button" className="btn sm" onClick={goToHardware}>
                Ir al circuito
              </button>
            </div>
          </div>
        ) : !hasCode ? (
          <div className="flash-notice is-error">
            <CircleAlert size={18} />
            <div>
              <strong>No se pudo preparar el programa</strong>
              <p>{sketch.error}</p>
            </div>
          </div>
        ) : null}

        <div className="flash-actions">
          <button type="button" className="btn primary flash-compile" onClick={onCompile} disabled={!hasCode || busy} title={hasCode ? 'Compilar el programa para la placa' : undefined}>
            {busy ? <LoaderCircle size={15} className="flash-spin" /> : <Hammer size={15} />}
            {busy ? 'Compilando…' : 'Compilar'}
          </button>
          {busy && userCompile && (
            <button type="button" className="btn icon ghost" onClick={onCancel} title="Cancelar la compilación" aria-label="Cancelar la compilación">
              <X size={15} />
            </button>
          )}
          <StatusChip status={status} busy={busy} stale={stale} elapsedMs={elapsed} durationMs={result?.durationMs} />
        </div>

        {busy && (
          <div className="flash-progress is-indeterminate" aria-hidden>
            <div />
          </div>
        )}
        {busy && result?.log && <p className="flash-hint">{result.log}</p>}
        {busy && board === 'esp32c6' && !result?.log && <p className="flash-hint">El ESP32-C6 tarda un poco más en compilar (unos 15–20 s).</p>}

        {!result && !busy && hasCode && <EmptyState boardName={profile?.name ?? null} />}

        {result && !busy && stale && (
          <p className="flash-stale">
            {boardMismatch
              ? `Esta compilación es para ${resultProfile?.name ?? 'otra placa'}. Vuelve a compilar para ${profile?.name ?? 'la placa actual'}.`
              : 'El programa cambió desde la última compilación. Vuelve a compilar para cargar la versión nueva.'}
          </p>
        )}

        {result && !busy && result.status === 'success' && (
          <section className="flash-success">
            <div className="flash-success-head">
              <CircleCheck size={16} />
              <span>
                Compilado sin errores
                {result.durationMs !== undefined && <span className="flash-muted"> · {formatSeconds(result.durationMs)}</span>}
              </span>
            </div>
            {result.sizes && (
              <div className="flash-usages">
                <UsageBar label="Memoria del programa (flash)" used={result.sizes.flashBytes} max={result.sizes.flashMax} />
                {result.sizes.ramBytes !== undefined && (
                  <UsageBar label="Memoria para variables (RAM)" used={result.sizes.ramBytes} max={result.sizes.ramMax ?? 0} />
                )}
              </div>
            )}
            <div className="flash-buttons">
              <button
                type="button"
                className="btn"
                onClick={onDownload}
                disabled={!result.artifactUrl || stale}
                title={stale ? 'El programa cambió desde la última compilación: vuelve a compilar.' : undefined}
              >
                <Download size={15} /> Descargar {artifactExt(result)}
              </button>
              <span className="flash-btn-wrap" title={flashTitle}>
                <button type="button" className="btn flash-usb" onClick={onFlash} disabled={!canFlash}>
                  {isFlashing && flashForThis ? <LoaderCircle size={15} className="flash-spin" /> : <Usb size={15} />}
                  {isFlashing && flashForThis ? 'Cargando…' : 'Cargar a la placa (USB)'}
                </button>
              </span>
            </div>
            {!serialOk && <p className="flash-hint">La carga por USB funciona en Google Chrome o Microsoft Edge. Igual puedes descargar el archivo.</p>}
            {downloadError && <p className="flash-inline-error">{downloadError}</p>}
          </section>
        )}

        {flashForThis && isFlashing && (
          <div className="flash-flashing">
            <div className="flash-flashing-head">
              <span>{flash.message || 'Cargando…'}</span>
              <span className="flash-mono">{Math.round(flash.fraction * 100)} %</span>
            </div>
            <div className="flash-progress">
              <div style={{ width: `${Math.max(2, flash.fraction * 100)}%` }} />
            </div>
          </div>
        )}
        {flashForThis && flash.phase === 'done' && (
          <div className="flash-banner is-ok">
            <CircleCheck size={16} />
            <span>¡Listo! El programa ya está corriendo en tu {resultProfile?.name ?? 'placa'}.</span>
          </div>
        )}
        {flashForThis && flash.phase === 'error' && flash.error && (
          <div className="flash-banner is-error">
            <CircleAlert size={16} />
            <span>
              <strong>{flash.error.message}</strong>
              {flash.error.hint && <span className="flash-banner-hint">{flash.error.hint}</span>}
            </span>
          </div>
        )}

        {result && !busy && result.status === 'error' && noErrorDiag && (
          <div className="flash-banner is-error">
            <CircleAlert size={16} />
            <span>
              <strong>No se pudo compilar</strong>
              <span className="flash-banner-hint flash-pre">{logSummary(result.log) || 'El compilador terminó con un error.'}</span>
            </span>
          </div>
        )}

        {result && !busy && <DiagnosticsList diagnostics={result.diagnostics} code={compiledCode} />}

        {result && !busy && result.log && (
          <section className={clsx('flash-log', logOpen && 'is-open')}>
            <button type="button" className="flash-log-toggle" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen}>
              <Terminal size={13} />
              Registro del compilador
              <span className="flash-log-caret" />
            </button>
            {logOpen && <pre className="flash-log-pre">{result.log}</pre>}
          </section>
        )}
      </div>
    </div>
  );
}
