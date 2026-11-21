// One live supervisor session (owner: Anaís): WebSocket client, frame capture, voice, and the state the
// UI draws (checklist statuses, subtitle, open issue, debug). Shared by the main page and the simulator.
import { useEffect, useRef, useState } from 'react';
import type { Hello, WsClientMessage } from '../contracts/ws_client_message';
import type { Debug, Issue, Task, WsServerMessage } from '../contracts/ws_server_message';
import { startCapture } from '../source/capture';
import { SessionClient } from './client';
import { VoicePlayer } from './voice';

export const FPS = 6;

export type SessionView = {
  task: Task | null;
  statuses: Record<string, string>;
  subtitle: string;
  issue: Issue | null;
  debug: Debug | null;
  status: string;
};

const EMPTY: Omit<SessionView, 'status'> = { task: null, statuses: {}, subtitle: '', issue: null, debug: null };

export function useSession() {
  const [view, setView] = useState<SessionView>({ ...EMPTY, status: 'Desconectado' });
  const generation = useRef(0); // bumped on every attempt/stop: events from an older session are ignored
  const cleanups = useRef<(() => void)[]>([]);
  const client = useRef<SessionClient | null>(null);
  const voice = useRef(new VoicePlayer());
  const patch = (p: Partial<SessionView>) => setView((v) => ({ ...v, ...p }));

  function stop(status = 'Detenido') {
    generation.current += 1;
    cleanups.current.forEach((f) => f());
    cleanups.current = [];
    client.current = null;
    voice.current.stop();
    patch({ status });
  }

  /** Stop any running session and clear the view. Returns a check that is true while this attempt is current. */
  function newAttempt(): () => boolean {
    stop('Conectando…');
    setView({ ...EMPTY, status: 'Conectando…' });
    const mine = generation.current;
    return () => generation.current === mine;
  }

  function onMessage(message: WsServerMessage) {
    switch (message.type) {
      case 'ready':
        patch({ task: message.task, status: 'Conectado' });
        break;
      case 'state':
        patch({ statuses: message.statuses });
        break;
      case 'issue':
        patch({ issue: message });
        break;
      case 'issue_clear':
        patch({ issue: null });
        break;
      case 'say':
        patch({ subtitle: message.text });
        voice.current.say(message);
        break;
      case 'debug':
        if (message.observation) patch({ debug: message });
        break;
      case 'error':
        patch({ status: `Error: ${message.message}` });
        break;
      case 'cancel_say':
        voice.current.cancel(message.id);
        break;
    }
  }

  /** Open the session and stream `source`. `extra` cleanups run on stop (close the camera, the clip…). */
  function connect(current: () => boolean, hello: Hello, source: HTMLVideoElement | HTMLCanvasElement, extra: (() => void)[] = []) {
    const c = new SessionClient(hello, {
      onMessage: (message) => current() && onMessage(message),
      onAudio: (id, audio) => current() && voice.current.play(id, audio),
      onClose: (reason) => current() && patch({ status: `Desconectado: ${reason}` }),
    });
    client.current = c;
    const stopCapture = startCapture(source, FPS, (jpeg) => c.sendFrame(jpeg));
    cleanups.current = [stopCapture, () => c.close(), ...extra];
  }

  function send(message: WsClientMessage) {
    client.current?.send(message);
  }

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { view, setStatus: (status: string) => patch({ status }), newAttempt, connect, stop, send };
}
