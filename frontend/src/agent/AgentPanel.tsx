/**
 * Right sidebar (380 px): conversation with the Claude tutor. The loop lives in
 * loop.ts, the conversation in store.ts (sessionStorage), tools in tools.ts.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { AgentHeader, type AgentActivity } from './AgentHeader';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { answerDecision, newConversation, openDecision, retryTurn, sendMessage, stopAgent, undoTurn } from './loop';
import { danglingToolUses } from './history';
import { useAgent } from './store';
import { TurnView } from './TurnView';
import './agent.css';

function activityOf(status: string | undefined, busy: boolean, answering: boolean): AgentActivity {
  if (status === 'waiting-user' || answering) return 'waiting';
  if (!busy) return 'idle';
  return status === 'tools' ? 'working' : 'thinking';
}

export function AgentPanel() {
  const turns = useAgent((s) => s.turns);
  const busy = useAgent((s) => s.busy);
  const messages = useAgent((s) => s.messages);
  const last = turns[turns.length - 1];
  const answering = !!openDecision();
  const activity = activityOf(last?.status, busy, answering);

  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = useCallback((text: string) => {
    stickRef.current = true;
    void sendMessage(text);
  }, []);

  const canAnswer = useCallback(
    (toolUseId: string) => busy || danglingToolUses(messages).some((tu) => tu.id === toolUseId),
    [busy, messages],
  );

  const onAnswer = useCallback((id: string, a: { choiceId: string | null; text?: string }) => {
    stickRef.current = true;
    answerDecision(id, a);
  }, []);

  return (
    <div className="agent-panel">
      <AgentHeader activity={activity} onNew={newConversation} canReset={turns.length > 0 || busy} />
      <div className="agent-list" ref={listRef} onScroll={onScroll}>
        {turns.length === 0 ? (
          <EmptyState onPick={send} disabled={busy} />
        ) : (
          turns.map((t, i) => (
            <TurnView
              key={t.id}
              turn={t}
              isLast={i === turns.length - 1}
              busy={busy}
              canAnswer={canAnswer}
              onAnswer={onAnswer}
              onRetry={retryTurn}
              onUndo={undoTurn}
            />
          ))
        )}
      </div>
      <Composer busy={busy} answering={answering} onSend={send} onStop={stopAgent} />
    </div>
  );
}
