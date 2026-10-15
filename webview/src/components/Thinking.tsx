import { useState } from 'react';
import type { Item } from '../state';

type ThinkingItem = Extract<Item, { kind: 'thinking' }>;

export function thinkingLabel({ startedAt, endedAt }: { startedAt?: number; endedAt?: number }): string {
  if (endedAt === undefined) return 'Thinking…';
  const seconds = Math.max(1, Math.round((endedAt - (startedAt ?? endedAt)) / 1000));
  return `Thought for ${seconds}s`;
}

export function Thinking({ item }: { item: ThinkingItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button className="thinking-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {thinkingLabel(item)}
      </button>
      {open && <div className="thinking-text">{item.text}</div>}
    </div>
  );
}
