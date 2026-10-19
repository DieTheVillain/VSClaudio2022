import type { ConnectionState, HostToWebview, PermissionMode, PermissionOutcome, SidecarEvent } from '../../protocol/src/index';

export type ToolStatus = 'running' | 'ok' | 'error';

export type PermissionItem = {
  kind: 'permission';
  id: string;
  request: Extract<SidecarEvent, { t: 'permission_request' }>;
  outcome?: PermissionOutcome;
  at?: number;
};

// `at` (ms since epoch) is set on user messages and on the first item of each reply.
export type Item = { at?: number } & (
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string; startedAt?: number; endedAt?: number }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input?: unknown; result?: string; truncated?: boolean; status: ToolStatus }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string }
) | PermissionItem;

export interface ChatState {
  connection: ConnectionState;
  connectionDetail?: string;
  setup?: { code: string; message: string };
  sessionId?: string;
  model?: string;
  mode?: PermissionMode;
  running: boolean;
  items: Item[];
  theme: Record<string, string>;
  nextLocalId: number;
}

// Timestamps arrive with the action so the reducer stays pure.
export type Action = { type: 'host'; msg: HostToWebview; at: number } | { type: 'user_send'; text: string; at: number } | { type: 'clear' };

export const initialState: ChatState = { connection: 'starting', running: false, items: [], theme: {}, nextLocalId: 1 };

type ToolItem = Extract<Item, { kind: 'tool' }>;

// Appends an item, stamping it with `at` when it is the first item of a reply.
function append(s: ChatState, item: Item, at: number): ChatState {
  const startsReply = item.kind !== 'user' && s.items.at(-1)?.kind === 'user';
  return { ...s, items: [...s.items, startsReply ? { ...item, at } : item] };
}

function withLocal(s: ChatState, at: number, make: (id: string) => Item): ChatState {
  return { ...append(s, make(`local-${s.nextLocalId}`), at), nextLocalId: s.nextLocalId + 1 };
}

// Marks any thinking block that is still streaming as finished.
function closeThinking(s: ChatState, at: number): ChatState {
  if (!s.items.some((i) => i.kind === 'thinking' && i.endedAt === undefined)) return s;
  return { ...s, items: s.items.map((i) => (i.kind === 'thinking' && i.endedAt === undefined ? { ...i, endedAt: at } : i)) };
}

// A turn that ends (or a session that goes away) can no longer be answered, so open requests are cancelled.
function cancelPending(s: ChatState): ChatState {
  if (!s.items.some((i) => i.kind === 'permission' && i.outcome === undefined)) return s;
  return { ...s, items: s.items.map((i) => (i.kind === 'permission' && i.outcome === undefined ? { ...i, outcome: 'cancelled' as const } : i)) };
}

function updateTool(s: ChatState, toolUseId: string, name: string, patch: Partial<ToolItem>, at: number): ChatState {
  const idx = s.items.findIndex((i) => i.kind === 'tool' && i.toolUseId === toolUseId);
  if (idx === -1) {
    return append(s, { kind: 'tool', id: `tool-${toolUseId}`, toolUseId, name, status: 'running', ...patch }, at);
  }
  const items = s.items.slice();
  items[idx] = { ...(items[idx] as ToolItem), ...patch };
  return { ...s, items };
}

function onHost(s: ChatState, msg: HostToWebview, at: number): ChatState {
  switch (msg.t) {
    case 'status': {
      const next = { ...s, connection: msg.state, connectionDetail: msg.detail, setup: msg.state === 'connected' ? undefined : s.setup };
      // The host restarted the session in a different folder; the old transcript no longer applies.
      return msg.detail === 'workspace_changed' ? { ...cancelPending(next), items: [], running: false, sessionId: undefined } : next;
    }
    case 'theme':
      return { ...s, theme: msg.vars };
    case 'ready':
      return s;
    case 'session':
      return { ...s, sessionId: msg.sessionId, model: msg.model };
    case 'block_start': {
      const closed = closeThinking(s, at);
      if (msg.kind === 'tool_use') {
        if (closed.items.some((i) => i.kind === 'tool' && i.toolUseId === msg.toolUseId)) return closed;
        return append(closed, { kind: 'tool', id: msg.key, toolUseId: msg.toolUseId!, name: msg.name ?? 'Tool', status: 'running' }, at);
      }
      if (msg.kind === 'thinking') return append(closed, { kind: 'thinking', id: msg.key, text: '', startedAt: at }, at);
      return append(closed, { kind: msg.kind, id: msg.key, text: '' }, at);
    }
    case 'block_delta': {
      const idx = s.items.findIndex((i) => i.id === msg.key && (i.kind === 'text' || i.kind === 'thinking'));
      if (idx === -1) return s;
      const items = s.items.slice();
      const item = items[idx] as Extract<Item, { kind: 'text' | 'thinking' }>;
      items[idx] = { ...item, text: item.text + msg.text };
      return { ...s, items };
    }
    case 'tool_input':
      return updateTool(s, msg.toolUseId, msg.name, { input: msg.input }, at);
    case 'tool_result':
      return updateTool(s, msg.toolUseId, 'Tool', { result: msg.content, truncated: msg.truncated, status: msg.isError ? 'error' : 'ok' }, at);
    case 'turn_end': {
      let next: ChatState = { ...cancelPending(closeThinking(s, at)), running: false };
      if (msg.status === 'success') return next;
      if (msg.status === 'interrupted') {
        next = {
          ...next,
          items: next.items.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'error' as const, result: 'Interrupted' } : i)),
        };
        return withLocal(next, at, (id) => ({ kind: 'notice', id, level: 'info', text: msg.error ? `Interrupted: ${msg.error}` : 'Interrupted' }));
      }
      return withLocal(next, at, (id) => ({ kind: 'notice', id, level: 'error', text: msg.error ?? 'Something went wrong.' }));
    }
    case 'error':
      if (msg.code === 'fatal') return withLocal({ ...cancelPending(closeThinking(s, at)), running: false }, at, (id) => ({ kind: 'notice', id, level: 'error', text: msg.message }));
      return { ...s, running: false, setup: { code: msg.code, message: msg.message } };
    case 'permission_request':
      return append(s, { kind: 'permission', id: msg.id, request: msg }, at);
    case 'permission_resolved':
      return { ...s, items: s.items.map((i) => (i.kind === 'permission' && i.id === msg.id ? { ...i, outcome: msg.outcome } : i)) };
    case 'mode':
      return { ...s, mode: msg.mode };
    case 'notice':
      return withLocal(s, at, (id) => ({ kind: 'notice', id, level: msg.level, text: msg.text }));
    default:
      // prepare_edit is host-internal and never rendered.
      return s;
  }
}

export function reducer(s: ChatState, a: Action): ChatState {
  switch (a.type) {
    case 'host':
      return onHost(s, a.msg, a.at);
    case 'user_send':
      if (s.running || !a.text.trim()) return s;
      return { ...withLocal(s, a.at, (id) => ({ kind: 'user', id, text: a.text, at: a.at })), running: true };
    case 'clear':
      return { ...cancelPending(s), items: [], running: false, sessionId: undefined };
  }
}
