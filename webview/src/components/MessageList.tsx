import { useEffect, useRef, type ReactNode } from 'react';
import type { Item } from '../state';
import { EditCard } from './EditCard';
import { Markdown } from './Markdown';
import { PermissionCard } from './PermissionCard';
import { PlanCard } from './PlanCard';
import { QuestionCard } from './QuestionCard';
import type { Respond } from './cardParts';
import { Thinking } from './Thinking';
import { ToolCard } from './ToolCard';

type UserItem = Extract<Item, { kind: 'user' }>;
type ReplyItem = Exclude<Item, UserItem>;
type Group = { kind: 'user'; item: UserItem } | { kind: 'reply'; items: ReplyItem[] };

// User messages stand alone; everything between them forms one reply on a shared timeline.
function groupItems(items: Item[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    if (item.kind === 'user') {
      groups.push({ kind: 'user', item });
      continue;
    }
    const last = groups.at(-1);
    if (last?.kind === 'reply') last.items.push(item);
    else groups.push({ kind: 'reply', items: [item] });
  }
  return groups;
}

function Timestamp({ at }: { at?: number }) {
  if (at === undefined) return null;
  return <div className="timestamp">{new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>;
}

function dotClass(item: ReplyItem): string {
  if (item.kind === 'permission') return item.outcome === undefined ? 'tl-dot-pending' : 'tl-dot-muted';
  if (item.kind === 'tool') return `tl-dot-${item.status}`;
  if (item.kind === 'notice' && item.level === 'error') return 'tl-dot-error';
  return 'tl-dot-muted';
}

type CardHandlers = { respond: Respond; onOpenDiff: (id: string) => void };

function renderReply(item: ReplyItem, h: CardHandlers): ReactNode {
  switch (item.kind) {
    case 'text':
      return <Markdown text={item.text} />;
    case 'thinking':
      return <Thinking item={item} />;
    case 'tool':
      return <ToolCard item={item} />;
    case 'notice':
      return <div className={`notice notice-${item.level}`}>{item.text}</div>;
    case 'permission':
      switch (item.request.kind) {
        case 'edit':
          return <EditCard item={item} respond={h.respond} onOpenDiff={h.onOpenDiff} />;
        case 'plan':
          return <PlanCard item={item} respond={h.respond} />;
        case 'question':
          return <QuestionCard item={item} respond={h.respond} />;
        default:
          return <PermissionCard item={item} respond={h.respond} />;
      }
  }
}

const noop = () => {};

export function MessageList({ items, running, respond = noop, onOpenDiff = noop }: { items: Item[]; running: boolean; respond?: Respond; onOpenDiff?: (id: string) => void }) {
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
      {groupItems(items).map((group) =>
        group.kind === 'user' ? (
          <div key={group.item.id} className="user-turn">
            <Timestamp at={group.item.at} />
            <div className="user-msg">{group.item.text}</div>
          </div>
        ) : (
          <div key={group.items[0].id} className="reply">
            <Timestamp at={group.items[0].at} />
            <div className="timeline">
              {group.items.map((item) => (
                <div key={item.id} className={`tl-row tl-${item.kind}`}>
                  <span className={`tl-dot ${dotClass(item)}`} aria-hidden="true" />
                  <div className="tl-body">{renderReply(item, { respond, onOpenDiff })}</div>
                </div>
              ))}
            </div>
          </div>
        ),
      )}
      {running && !streaming && <div className="working">Working…</div>}
    </div>
  );
}
