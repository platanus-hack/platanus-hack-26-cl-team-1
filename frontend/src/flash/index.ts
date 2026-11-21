/**
 * WORKSTREAM B4 — compile client + Web Serial flashing (public API: import from '@/flash').
 *
 *  - compileSketch(board, code, {onStatus, signal, lineMap?})
 *        POST /api/compile, poll every 800 ms; EVERY status update is published in useCompile
 *        (so the agent's compile and <CompilePanel/> share the last result). Never throws:
 *        network problems come back as status 'error' with a Spanish log.
 *  - compileProject(project, opts)   generateCode + lineMap → compileSketch (diagnostics get blockId).
 *  - projectSketch(project)          { board, code, lineMap } | { error, board }.
 *  - flashArtifact(result, board, onProgress)
 *        Web Serial. Uno: STK500v1 (.hex, verify). ESP32-C6: esptool-js, merged .bin at 0x0
 *        (app-only fallback 'sketch.ino.bin' at 0x10000). MUST be called from a click.
 *        Throws FlashError {code, message, hint} (Spanish). Progress also mirrored in useFlash.
 *  - downloadArtifact(result) / downloadArtifactAsync(result)
 *  - webSerialSupported()
 */
export { useCompile, useFlash, type CompileStore, type FlashState } from './store';
export { compileSketch, type CompileOptions } from './compile';
export { compileProject, projectSketch, NO_BOARD_MESSAGE, type ProjectSketch } from './project';
export { flashArtifact, downloadArtifact, downloadArtifactAsync, webSerialSupported } from './flashing';
export { mapDiagnostics } from './client';
export { FlashError, type FlashErrorCode } from './errors';
export { CompilePanel } from './CompilePanel';
