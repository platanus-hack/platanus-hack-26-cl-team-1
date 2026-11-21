// Where the session server lives (owner: Anaís). Precedence: `?server=` (e.g. a tunnel), then the
// build-time VITE_SERVER_URL, then the page's own origin (the demo serves both from one origin, D-015).
// Both the HTTP API and the WebSocket derive from the same base.

export type ServerUrls = { http: string; ws: string };

const TO_HTTP: Record<string, string> = { 'http:': 'http:', 'https:': 'https:', 'ws:': 'http:', 'wss:': 'https:' };
const TO_WS: Record<string, string> = { 'http:': 'ws:', 'https:': 'wss:' };

export function resolveServer(
  search: string,
  envUrl: string | undefined,
  loc: { protocol: string; host: string },
): ServerUrls {
  const raw = new URLSearchParams(search).get('server') || envUrl || `${loc.protocol}//${loc.host}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`server URL is not a valid URL: ${raw}`);
  }
  const httpProtocol = TO_HTTP[url.protocol];
  if (!httpProtocol) throw new Error(`server URL must be http(s) or ws(s): ${raw}`);
  const rest = `//${url.host}${url.pathname}`.replace(/\/+$/, '');
  return { http: `${httpProtocol}${rest}`, ws: `${TO_WS[httpProtocol]}${rest}` };
}

export function serverUrls(): ServerUrls {
  return resolveServer(location.search, import.meta.env.VITE_SERVER_URL as string | undefined, location);
}

export function apiUrl(path: string): string {
  return serverUrls().http + path;
}

export function sessionWsUrl(): string {
  return `${serverUrls().ws}/ws/session`;
}
