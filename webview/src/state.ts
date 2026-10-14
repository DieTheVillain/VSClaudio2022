import type { ConnectionState, HostToWebview } from '../../protocol/src/index';

export type ToolStatus = 'running' | 'ok' | 'error';

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input?: unknown; result?: string; truncated?: boolean; status: ToolStatus }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

export interface ChatState {
  connection: ConnectionState;
  connectionDetail?: string;
  setup?: { code: string; message: string };
  sessionId?: string;
  model?: string;
  running: boolean;
  items: Item[];
  theme: Record<string, string>;
  nextLocalId: number;
}

export type Action = { type: 'host'; msg: HostToWebview } | { type: 'user_send'; text: string } | { type: 'clear' };

export const initialState: ChatState = { connection: 'starting', running: false, items: [], theme: {}, nextLocalId: 1 };

type ToolItem = Extract<Item, { kind: 'tool' }>;

function withLocal(s: ChatState, make: (id: string) => Item): ChatState {
  return { ...s, items: [...s.items, make(`local-${s.nextLocalId}`)], nextLocalId: s.nextLocalId + 1 };
}

function updateTool(s: ChatState, toolUseId: string, name: string, patch: Partial<ToolItem>): ChatState {
  const idx = s.items.findIndex((i) => i.kind === 'tool' && i.toolUseId === toolUseId);
  if (idx === -1) {
    return { ...s, items: [...s.items, { kind: 'tool', id: `tool-${toolUseId}`, toolUseId, name, status: 'running', ...patch }] };
  }
  const items = s.items.slice();
  items[idx] = { ...(items[idx] as ToolItem), ...patch };
  return { ...s, items };
}

function onHost(s: ChatState, msg: HostToWebview): ChatState {
  switch (msg.t) {
    case 'status': {
      const next = { ...s, connection: msg.state, connectionDetail: msg.detail, setup: msg.state === 'connected' ? undefined : s.setup };
      // The host restarted the session in a different folder; the old transcript no longer applies.
      return msg.detail === 'workspace_changed' ? { ...next, items: [], running: false, sessionId: undefined } : next;
    }
    case 'theme':
      return { ...s, theme: msg.vars };
    case 'ready':
      return s;
    case 'session':
      return { ...s, sessionId: msg.sessionId, model: msg.model };
    case 'block_start':
      if (msg.kind === 'tool_use') {
        if (s.items.some((i) => i.kind === 'tool' && i.toolUseId === msg.toolUseId)) return s;
        return { ...s, items: [...s.items, { kind: 'tool', id: msg.key, toolUseId: msg.toolUseId!, name: msg.name ?? 'Tool', status: 'running' }] };
      }
      return { ...s, items: [...s.items, { kind: msg.kind, id: msg.key, text: '' }] };
    case 'block_delta': {
      const idx = s.items.findIndex((i) => i.id === msg.key && (i.kind === 'text' || i.kind === 'thinking'));
      if (idx === -1) return s;
      const items = s.items.slice();
      const item = items[idx] as Extract<Item, { kind: 'text' | 'thinking' }>;
      items[idx] = { ...item, text: item.text + msg.text };
      return { ...s, items };
    }
    case 'tool_input':
      return updateTool(s, msg.toolUseId, msg.name, { input: msg.input });
    case 'tool_result':
      return updateTool(s, msg.toolUseId, 'Tool', { result: msg.content, truncated: msg.truncated, status: msg.isError ? 'error' : 'ok' });
    case 'turn_end': {
      let next: ChatState = { ...s, running: false };
      if (msg.status === 'success') return next;
      if (msg.status === 'interrupted') {
        next = {
          ...next,
          items: next.items.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'error' as const, result: 'Interrupted' } : i)),
        };
        return withLocal(next, (id) => ({ kind: 'notice', id, level: 'info', text: msg.error ? `Interrupted: ${msg.error}` : 'Interrupted' }));
      }
      return withLocal(next, (id) => ({ kind: 'notice', id, level: 'error', text: msg.error ?? 'Something went wrong.' }));
    }
    case 'error':
      if (msg.code === 'fatal') return withLocal({ ...s, running: false }, (id) => ({ kind: 'notice', id, level: 'error', text: msg.message }));
      return { ...s, running: false, setup: { code: msg.code, message: msg.message } };
  }
}

export function reducer(s: ChatState, a: Action): ChatState {
  switch (a.type) {
    case 'host':
      return onHost(s, a.msg);
    case 'user_send':
      if (s.running || !a.text.trim()) return s;
      return { ...withLocal(s, (id) => ({ kind: 'user', id, text: a.text })), running: true };
    case 'clear':
      return { ...s, items: [], running: false, sessionId: undefined };
  }
}
