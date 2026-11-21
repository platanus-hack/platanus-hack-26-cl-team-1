// WebSocket session client (owner: Anaís). Protocol: docs/CONTRACTS.md §5.
import type { Hello, WsClientMessage } from '../contracts/ws_client_message';
import type { WsServerMessage } from '../contracts/ws_server_message';
import { packFrame, unpackAudio } from './frames';

export type SessionHandlers = {
  onMessage: (message: WsServerMessage) => void;
  onAudio: (id: string, audio: Uint8Array) => void;
  onClose: (reason: string) => void;
};

/** `?server=wss://host` overrides the server (e.g. the GPU box's tunnel); otherwise same origin. */
export function sessionUrl(): string {
  const override = new URLSearchParams(location.search).get('server');
  const base = override ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
  return `${base.replace(/\/$/, '')}/ws/session`;
}

export class SessionClient {
  private ws: WebSocket;
  private seq = 0;
  private readonly t0 = performance.now();

  constructor(hello: Hello, handlers: SessionHandlers, url = sessionUrl()) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.send(hello);
    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handlers.onMessage(JSON.parse(event.data) as WsServerMessage);
      } else {
        const { id, audio } = unpackAudio(event.data as ArrayBuffer);
        handlers.onAudio(id, audio);
      }
    };
    this.ws.onclose = (event) => handlers.onClose(event.reason || `closed (${event.code})`);
  }

  send(message: WsClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendFrame(jpeg: ArrayBuffer): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(packFrame(this.seq++, Math.round(performance.now() - this.t0), jpeg));
  }

  close(): void {
    this.ws.close();
  }
}
