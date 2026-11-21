import { describe, expect, it } from 'vitest';
import { applyH, healthUrl, normalizeVisionUrl } from './store';

describe('vision URL helpers', () => {
  it('normalises whatever the user pastes into the WS endpoint', () => {
    expect(normalizeVisionUrl('https://abc.trycloudflare.com')).toBe('wss://abc.trycloudflare.com/ws/session');
    expect(normalizeVisionUrl(' abc.trycloudflare.com ')).toBe('wss://abc.trycloudflare.com/ws/session');
    expect(normalizeVisionUrl('wss://abc.trycloudflare.com/ws/session')).toBe('wss://abc.trycloudflare.com/ws/session');
    expect(normalizeVisionUrl('http://localhost:8100')).toBe('ws://localhost:8100/ws/session');
    expect(normalizeVisionUrl('')).toBe('');
  });

  it('derives the health check URL from the WS endpoint', () => {
    expect(healthUrl('wss://abc.trycloudflare.com/ws/session')).toBe('https://abc.trycloudflare.com/health');
    expect(healthUrl('ws://localhost:8100/ws/session')).toBe('http://localhost:8100/health');
    expect(healthUrl('nope')).toBe('');
  });

  it('applies a homography', () => {
    const H = [2, 0, 10, 0, 2, 20, 0, 0, 1];
    expect(applyH(H, 1, 1)).toEqual([12, 22]);
  });
});
