import { describe, expect, it } from 'vitest';
import { route } from './router';

describe('route', () => {
  it('opens the supervisor page with or without a trailing slash', () => {
    expect(route('/supervisor')).toBe('supervisor');
    expect(route('/supervisor/')).toBe('supervisor');
  });

  it('marks the root for a redirect', () => {
    expect(route('/')).toBe('root');
  });

  it('opens the simulator page with or without a trailing slash', () => {
    expect(route('/simulador')).toBe('simulator');
    expect(route('/simulador/')).toBe('simulator');
  });

  it('reports unknown pages', () => {
    expect(route('/simulator')).toBe('not_found');
  });
});
