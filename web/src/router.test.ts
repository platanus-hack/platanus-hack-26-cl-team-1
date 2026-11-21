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

  it('reports unknown pages', () => {
    expect(route('/simulador')).toBe('not_found');
  });
});
