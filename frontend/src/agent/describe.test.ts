import { describe, expect, it } from 'vitest';
import type { ProjectModel } from '@/contracts';
import { createStarterProject } from '@/store/newProject';
import { describePinRef, describeToolCall, formatDuration } from './describe';

function project(): ProjectModel {
  const p = createStarterProject('uno');
  p.parts.push({ id: 'r1', type: 'resistor', label: 'R1', x: 40, y: 9, rotation: 0, props: { resistance: 220 } });
  p.parts.push({ id: 'led1', type: 'led', label: 'LED rojo', x: 47, y: 6, rotation: 0, props: { color: 'red' } });
  return p;
}

describe('describeToolCall', () => {
  const p = project();

  it('titles part additions', () => {
    expect(describeToolCall('add_part', { type: 'led', props: { color: 'red' } }, p)).toBe('Agregando LED rojo');
    expect(describeToolCall('add_part', { type: 'led', label: 'LED rojo' }, p)).toBe('Agregando LED rojo');
    expect(describeToolCall('add_part', { type: 'resistor', props: { resistance: 220 } }, p)).toBe('Agregando resistencia de 220 Ω');
    expect(describeToolCall('add_part', { type: 'resistor', props: { resistance: 4700 } }, p)).toBe('Agregando resistencia de 4,7 kΩ');
    expect(describeToolCall('add_part', { type: 'arduino-uno' }, p)).toBe('Agregando Arduino Uno');
    expect(describeToolCall('add_part', {}, p)).toBe('Agregando un componente');
  });

  it('titles connections with readable pin names', () => {
    expect(describeToolCall('connect', { from: 'uno1.D13', to: 'r1.a' }, p)).toBe('Conectando D13 → R1');
    expect(describeToolCall('connect', { from: 'r1.b', to: 'led1.anode' }, p)).toBe('Conectando R1 → LED rojo (ánodo)');
    expect(describeToolCall('connect', { from: 'led1.cathode', to: 'bb1.T-3' }, p)).toBe('Conectando LED rojo (cátodo) → riel − superior (columna 3)');
    expect(describeToolCall('connect', {}, p)).toBe('Conectando un cable');
    expect(describePinRef(p, 'bb1.e10')).toBe('e10');
    expect(describePinRef(p, 'zz.top')).toBe('zz.top');
  });

  it('titles the other tools', () => {
    expect(describeToolCall('simulate', { duration_ms: 3000 }, p)).toBe('Simulando 3 s');
    expect(describeToolCall('simulate', { duration_ms: 1500, inputs: [{}, {}] }, p)).toBe('Simulando 1,5 s con 2 acciones');
    expect(describeToolCall('compile', {}, p)).toBe('Compilando para Arduino Uno');
    expect(describeToolCall('compile', {}, null)).toBe('Compilando el programa');
    expect(describeToolCall('remove_part', { id: 'led1' }, p)).toBe('Quitando LED rojo');
    expect(describeToolCall('update_part', { id: 'r1', props: { resistance: 330 } }, p)).toBe('Cambiando R1 a 330 Ω');
    expect(describeToolCall('update_part', { id: 'led1', props: { color: 'green' } }, p)).toBe('Cambiando LED rojo a verde');
    expect(describeToolCall('update_part', { id: 'led1', rotation: 90 }, p)).toBe('Girando LED rojo');
    expect(describeToolCall('set_program', { program: { setup: [], loop: [{}, {}, {}, {}] } }, p)).toBe('Escribiendo el programa (4 bloques)');
    expect(describeToolCall('load_example', { example_id: 'traffic-light-uno' }, p)).toBe('Cargando el ejemplo «Semáforo»');
    expect(describeToolCall('switch_view', { view: 'schematic' }, p)).toBe('Mostrándote el esquema');
    expect(describeToolCall('new_project', { board: 'esp32c6' }, p)).toBe('Empezando un proyecto nuevo con ESP32-C6');
    expect(describeToolCall('new_project', {}, p)).toBe('Empezando un proyecto nuevo con Arduino Uno');
    expect(describeToolCall('get_project', undefined, p)).toBe('Revisando tu proyecto');
    expect(describeToolCall('ask_user', { question: '¿Qué placa?' }, p)).toBe('Esperando tu respuesta');
  });

  it('formats durations', () => {
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(2000)).toBe('2 s');
    expect(formatDuration(2250)).toBe('2,3 s');
  });
});
