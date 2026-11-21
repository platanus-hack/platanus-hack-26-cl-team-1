import { memo, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from './mdParse';

function renderInline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'br':
        return <br key={k} />;
      case 'code':
        return (
          <code key={k} className="agent-md-code">
            {n.v}
          </code>
        );
      case 'bold':
        return <strong key={k}>{renderInline(n.c, `${k}-`)}</strong>;
      case 'italic':
        return <em key={k}>{renderInline(n.c, `${k}-`)}</em>;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'h':
      return (
        <p key={i} className={`agent-md-h agent-md-h${Math.min(b.level, 3)}`}>
          {renderInline(b.c)}
        </p>
      );
    case 'ul':
      return (
        <ul key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case 'code':
      return (
        <pre key={i} className="agent-md-pre">
          {b.lang && <span className="agent-md-lang">{b.lang}</span>}
          <code>{b.v}</code>
        </pre>
      );
  }
}

/** Assistant text as safe React elements (no HTML injection). */
export const Markdown = memo(function Markdown({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={caret ? 'agent-md agent-md--streaming' : 'agent-md'}>
      {blocks.length ? blocks.map(renderBlock) : caret ? <p /> : null}
    </div>
  );
});
