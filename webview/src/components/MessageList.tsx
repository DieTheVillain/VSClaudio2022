import { useEffect, useRef } from 'react';
import type { Item } from '../state';
import { Markdown } from './Markdown';
import { Thinking } from './Thinking';
import { ToolCard } from './ToolCard';

export function MessageList({ items, running }: { items: Item[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output only while the user is at the bottom; scrolling up stops the follow.
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const last = items.at(-1);
  const streaming = last && (last.kind === 'text' || last.kind === 'thinking');

  return (
    <div
      className="messages"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return <div key={item.id} className="user-msg">{item.text}</div>;
          case 'text':
            return <Markdown key={item.id} text={item.text} />;
          case 'thinking':
            return <Thinking key={item.id} text={item.text} />;
          case 'tool':
            return <ToolCard key={item.id} item={item} />;
          case 'notice':
            return <div key={item.id} className={`notice notice-${item.level}`}>{item.text}</div>;
        }
      })}
      {running && !streaming && <div className="working">Working…</div>}
    </div>
  );
}
