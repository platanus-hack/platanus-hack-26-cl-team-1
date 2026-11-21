import { describe, expect, it } from 'vitest';
import type { Netlist, Wire } from '@/contracts';
import { autoWireColor, classifyEndpoint, classifyPin, SIGNAL_CYCLE } from './wireColor';
import { part, project, unoAndBreadboard } from './fixtures';

const p = project([...unoAndBreadboard(), part('led1', 'led', 40, 6), part('bat1', 'battery-9v', 80, 0)]);

describe('classifyPin', () => {
  it('uses the pin kind of board pins', () => {
    expect(classifyPin(p, 'uno1.GND1')).toBe('ground');
    expect(classifyPin(p, 'uno1.5V')).toBe('power');
    expect(classifyPin(p, 'uno1.3V3')).toBe('power');
    expect(classifyPin(p, 'uno1.D13')).toBe('signal');
  });

  it('uses rail polarity for breadboard holes', () => {
    expect(classifyPin(p, 'bb1.T-3')).toBe('ground');
    expect(classifyPin(p, 'bb1.B-7')).toBe('ground');
    expect(classifyPin(p, 'bb1.T+1')).toBe('power');
    expect(classifyPin(p, 'bb1.a10')).toBe('signal');
  });

  it('does not treat component polarity (LED anode/cathode) as power/ground', () => {
    expect(classifyPin(p, 'led1.anode')).toBe('signal');
    expect(classifyPin(p, 'led1.cathode')).toBe('signal');
  });

  it('treats battery terminals as supply pins', () => {
    expect(classifyPin(p, 'bat1.minus')).toBe('ground');
    expect(classifyPin(p, 'bat1.plus')).toBe('power');
  });

  it('is robust to unknown refs', () => {
    expect(classifyPin(p, 'nope.x')).toBe('signal');
    expect(classifyPin(p, 'uno1.NOPE')).toBe('signal');
  });
});

describe('classifyEndpoint', () => {
  const netlist: Netlist = {
    nets: [
      { id: 'n1', pins: ['led1.cathode', 'bb1.a11', 'uno1.GND1'], name: 'GND', wires: [] },
      { id: 'n2', pins: ['bb1.a20', 'bb1.T+5'], wires: [] },
      { id: 'n3', pins: ['bb1.a15', 'uno1.D13'], name: 'D13', wires: [] },
    ],
    pinNet: { 'led1.cathode': 'n1', 'bb1.a11': 'n1', 'uno1.GND1': 'n1', 'bb1.a20': 'n2', 'bb1.T+5': 'n2', 'bb1.a15': 'n3', 'uno1.D13': 'n3' },
    insertions: [],
  };

  it('uses the net name', () => {
    expect(classifyEndpoint(p, netlist, 'bb1.a11')).toBe('ground');
    expect(classifyEndpoint(p, netlist, 'bb1.a15')).toBe('signal');
  });

  it('detects nets that reach a rail', () => {
    expect(classifyEndpoint(p, netlist, 'bb1.a20')).toBe('power');
  });

  it('falls back to the pin when there is no netlist', () => {
    expect(classifyEndpoint(p, null, 'bb1.a11')).toBe('signal');
    expect(classifyEndpoint(p, null, 'uno1.GND2')).toBe('ground');
  });
});

describe('autoWireColor', () => {
  const w = (id: string, color: Wire['color']): Wire => ({ id, from: 'a.x', to: 'b.y', color });

  it('black wins for ground, then red for power', () => {
    expect(autoWireColor('ground', 'signal', [])).toBe('black');
    expect(autoWireColor('signal', 'ground', [])).toBe('black');
    expect(autoWireColor('power', 'ground', [])).toBe('black');
    expect(autoWireColor('power', 'signal', [])).toBe('red');
  });

  it('cycles signal colours ignoring red/black wires', () => {
    expect(autoWireColor('signal', 'signal', [])).toBe('yellow');
    expect(autoWireColor('signal', 'signal', [w('w1', 'red'), w('w2', 'black')])).toBe('yellow');
    expect(autoWireColor('signal', 'signal', [w('w1', 'yellow')])).toBe('green');
    const six = SIGNAL_CYCLE.map((c, i) => w(`w${i}`, c));
    expect(autoWireColor('signal', 'signal', six)).toBe('yellow');
  });
});
