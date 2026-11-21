/**
 * Real compile check of generated sketches. Skipped unless ARDUINO_CLI points
 * to an arduino-cli binary with the avr / esp32 cores (+ Servo / ESP32Servo):
 *   ARDUINO_CLI=/path/to/arduino-cli [ARDUINO_LIBS=dir] [CV_BUILD_DIR=dir] [CV_COMPILE_JOBS=4] \
 *     npx vitest run src/program/codegen/arduino-compile
 * Compiles the whole corpus (corpus.ts: every node kind × every operand type,
 * risky user names / labels, degenerate programs) plus the 7 examples
 * (buildExample → getProgramIR → generateCode) on both boards. ANY compile
 * error is a codegen bug.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BoardId } from '@/contracts';
import { EXAMPLES, buildExample } from '@/examples';
import { getProgramIR } from '@/program/blocks';
import { programContext } from '@/program/context';
import { compileCorpus } from './corpus';
import { generateCode } from './index';

const CLI = process.env.ARDUINO_CLI;
const BUILD = process.env.CV_BUILD_DIR ?? join(tmpdir(), 'cv-codegen');
const JOBS = Number(process.env.CV_COMPILE_JOBS ?? 4);
const run = promisify(execFile);

interface Sketch {
  name: string;
  board: BoardId;
  code: string;
}

async function compile(s: Sketch): Promise<string | null> {
  const dir = join(BUILD, s.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s.name}.ino`), s.code);
  const fqbn = s.board === 'uno' ? 'arduino:avr:uno' : 'esp32:esp32:esp32c6';
  const libs = process.env.ARDUINO_LIBS ? ['--libraries', process.env.ARDUINO_LIBS] : [];
  try {
    await run(CLI!, ['compile', '--fqbn', fqbn, ...libs, '--build-path', join(dir, 'build'), dir], { maxBuffer: 32 * 1024 * 1024 });
    return null;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const lines = `${err.stderr ?? ''}\n${err.stdout ?? ''}`.split('\n').filter((l) => /error|too big|exceeds/i.test(l));
    return `${s.name} (${s.board}):\n  ${lines.slice(0, 8).join('\n  ')}`;
  }
}

async function compileAll(sketches: Sketch[]): Promise<string[]> {
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < sketches.length) {
      const s = sketches[next++];
      const f = await compile(s);
      if (f) failures.push(f);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
  return failures;
}

function exampleSketches(): Sketch[] {
  return EXAMPLES.map((e) => {
    const project = buildExample(e.id);
    const ctx = programContext(project);
    return { name: `ex_${e.id.replace(/-/g, '_')}`, board: ctx.board?.id ?? 'uno', code: generateCode(getProgramIR(project), ctx).code };
  });
}

describe.skipIf(!CLI)('generated sketches compile with arduino-cli', () => {
  it('the 7 examples', async () => {
    expect(await compileAll(exampleSketches())).toEqual([]);
  }, 900_000);

  it('the whole codegen corpus on both boards', async () => {
    const sketches = compileCorpus().map((c) => ({ name: c.name, board: c.board, code: generateCode(c.ir, c.ctx).code }));
    expect(await compileAll(sketches)).toEqual([]);
  }, 1_800_000);
});
