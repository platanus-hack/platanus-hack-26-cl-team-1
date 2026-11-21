import { describe, expect, it } from 'vitest';
import { resolveServer } from './server';

const loc = { protocol: 'http:', host: 'localhost:5173' };

describe('resolveServer', () => {
  it('defaults to the page origin', () => {
    expect(resolveServer('', undefined, loc)).toEqual({ http: 'http://localhost:5173', ws: 'ws://localhost:5173' });
  });

  it('uses wss on an https page', () => {
    expect(resolveServer('', undefined, { protocol: 'https:', host: 'x.onrender.com' })).toEqual({
      http: 'https://x.onrender.com',
      ws: 'wss://x.onrender.com',
    });
  });

  it('uses VITE_SERVER_URL without its trailing slash', () => {
    expect(resolveServer('', 'https://t.trycloudflare.com/', loc)).toEqual({
      http: 'https://t.trycloudflare.com',
      ws: 'wss://t.trycloudflare.com',
    });
  });

  it('lets ?server= win over VITE_SERVER_URL, mapping wss to https', () => {
    expect(resolveServer('?server=wss://a.example/', 'https://env.example', loc)).toEqual({
      http: 'https://a.example',
      ws: 'wss://a.example',
    });
  });

  it('maps ws to http and keeps the port', () => {
    expect(resolveServer('?server=ws://127.0.0.1:8000', undefined, loc)).toEqual({
      http: 'http://127.0.0.1:8000',
      ws: 'ws://127.0.0.1:8000',
    });
  });

  it('treats an empty VITE_SERVER_URL as unset', () => {
    expect(resolveServer('', '', loc)).toEqual({ http: 'http://localhost:5173', ws: 'ws://localhost:5173' });
  });

  it('rejects other schemes', () => {
    expect(() => resolveServer('?server=ftp://x', undefined, loc)).toThrow(/server/);
  });
});
