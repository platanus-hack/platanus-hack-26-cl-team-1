/**
 * Exports the hello payload of every Arduino Uno example to vision/tests/fixtures/<id>.json,
 * so the Python side (expected.py) is tested against what the app really sends.
 *   UPDATE_FIXTURES=1 npx vitest run src/assembly/fixtures.test.ts   → rewrite them
 * Without the env var the test fails when a fixture is stale (TS and Python drifted).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PartDef } from '@/contracts';
import { findPartDef } from '@/catalog';
import { EXAMPLES, buildExample } from '@/examples';
import { buildWiringGuide } from '@/guide';
import { getNetlist } from '@/store/derived';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../vision/tests/fixtures');

function fixture(id: string) {
  const project = buildExample(id);
  const netlist = getNetlist(project);
  const steps = buildWiringGuide(project, netlist);
  const parts: Record<string, PartDef> = {};
  for (const p of project.parts) {
    const def = findPartDef(p.type);
    if (def) parts[p.type] = def;
  }
  // id is random and meta has timestamps; the program is irrelevant to the vision server.
  const stable = { ...project, id: `example-${id}`, meta: { exampleId: id }, program: { workspace: null } };
  return { type: 'hello', protocol: 1, project: stable, netlist, steps, parts, record: false, debug: false };
}

describe('vision fixtures', () => {
  for (const ex of EXAMPLES.filter((e) => e.board === 'uno')) {
    it(`${ex.id} matches vision/tests/fixtures`, () => {
      const json = JSON.stringify(fixture(ex.id), null, 1) + '\n';
      const file = resolve(DIR, `${ex.id}.json`);
      if (process.env.UPDATE_FIXTURES) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, json);
      }
      expect(existsSync(file), `falta ${file}: corre con UPDATE_FIXTURES=1`).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(json);
    });
  }
});
