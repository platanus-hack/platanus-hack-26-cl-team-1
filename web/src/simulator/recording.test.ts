import taskJson from '../../../tasks/aviation/c172_takeoff.json';
import { describe, expect, it } from 'vitest';
import type { Task } from '../contracts/ws_server_message';
import { doneSteps, labelRun, newRunId } from './recording';

const task = taskJson as unknown as Task;

const ID = /^[a-z][a-z0-9_]*$/;

describe('labelRun', () => {
  it('labels a correct expert run: an idle lead-in, then one correct clip per step', () => {
    const events = task.steps.map((s, i) => ({ t: 2 + i * 3, action: s.action }));
    const { clips, dropped } = labelRun(task, 'rec_test', events, 40, 'train');
    expect(dropped).toEqual([]);
    expect(clips[0]).toMatchObject({ action: null, step: null, is_correct: true, path: 'recorded/rec_test.webm#t=0,2' });
    expect(clips.slice(1).map((c) => c.step)).toEqual(task.steps.map((s) => s.id));
    expect(clips.every((c) => c.is_correct && c.mistake_id === null && ID.test(c.id))).toBe(true);
    expect(clips.at(-1)?.path).toBe('recorded/rec_test.webm#t=29,40');
  });

  it('labels task mistakes and defined out-of-order mistakes', () => {
    const events = [
      { t: 1, action: 'start_engine' }, // before master/fuel/mixture: start_not_ready
      { t: 3, action: 'set_flaps_full' },
    ];
    const { clips } = labelRun(task, 'rec_test', events, 6, 'train');
    expect(clips.slice(1).map((c) => [c.is_correct, c.mistake_id])).toEqual([
      [false, 'start_not_ready'],
      [false, 'flaps_full'],
    ]);
  });

  it('drops wrong segments it cannot label, and says why', () => {
    const events = [{ t: 1, action: 'set_flaps_takeoff' }]; // out of order, no MistakeDef for flaps_10
    const { clips, dropped } = labelRun(task, 'rec_test', events, 4, 'train');
    expect(clips).toHaveLength(1);
    expect(dropped).toEqual([{ t: 1, action: 'set_flaps_takeoff', reason: 'fuera de orden sin error definido' }]);
  });

  it('an action in the same instant as the next still advances the recipe, and is reported', () => {
    // master, fuel and mixture land on one timestamp (two keys before the next tick): only the last
    // keeps a segment, but all three count, so the engine start after them is in order.
    const events = [
      { t: 1, action: 'turn_master_on' },
      { t: 1, action: 'set_fuel_both' },
      { t: 1, action: 'set_mixture_rich' },
      { t: 2, action: 'start_engine' },
    ];
    const { clips, dropped } = labelRun(task, 'rec_test', events, 4, 'train');
    expect(clips.map((c) => [c.step, c.is_correct])).toEqual([
      [null, true],
      ['mixture_rich', true],
      ['engine_start', true],
    ]);
    expect(dropped.map((d) => d.action)).toEqual(['turn_master_on', 'set_fuel_both']);
    expect(dropped.every((d) => d.reason.startsWith('duró menos de 50 ms'))).toBe(true);
  });

  it('puts every clip of the run in the split it is given', () => {
    const { clips } = labelRun(task, 'rec_test', [{ t: 1, action: 'turn_master_on' }], 3, 'val');
    expect(clips.every((c) => c.split === 'val')).toBe(true);
  });
});

describe('doneSteps', () => {
  it('only counts steps done in a legal order', () => {
    const done = doneSteps(task, [
      { t: 0, action: 'start_engine' },
      { t: 1, action: 'turn_master_on' },
    ]);
    expect([...done]).toEqual(['master_on']);
  });
});

it('run ids are valid contract ids', () => {
  for (let i = 0; i < 20; i++) expect(newRunId()).toMatch(ID);
});
