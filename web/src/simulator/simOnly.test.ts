import { describe, expect, it } from 'vitest';
import { SIMULATORS } from './registry';
import { cameraTasks, SIM_ONLY_TASKS } from './simOnly';

describe('cameraTasks', () => {
  it('drops simulator-only tasks and keeps the order', () => {
    const list = [{ id: 'c172_takeoff' }, { id: 'hand_hygiene_basic' }, { id: 'led_flashlight' }];
    expect(cameraTasks(list).map((t) => t.id)).toEqual(['hand_hygiene_basic', 'led_flashlight']);
  });

  it('every simulator-only task has a simulator', () => {
    for (const id of SIM_ONLY_TASKS) expect(SIMULATORS[id]).toBeDefined();
  });
});
