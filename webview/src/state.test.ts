import { describe, expect, test } from 'vitest';
import { initialState, reducer, type Action, type ChatState } from './state';
import type { HostToWebview } from '../../protocol/src/index';

const host = (msg: HostToWebview, at = 0): Action => ({ type: 'host', msg, at });
const send = (text: string, at = 0): Action => ({ type: 'user_send', text, at });
const run = (actions: Action[], from: ChatState = initialState) => actions.reduce(reducer, from);

describe('reducer', () => {
  test('status updates the connection and clears setup on connect', () => {
    let s = run([host({ t: 'error', code: 'claude_not_found', message: 'nope' })]);
    expect(s.setup).toEqual({ code: 'claude_not_found', message: 'nope' });
    s = run([host({ t: 'status', state: 'connected' })], s);
    expect(s.connection).toBe('connected');
    expect(s.setup).toBeUndefined();
  });

  test('theme and session are stored', () => {
    const s = run([host({ t: 'theme', vars: { '--vsc-bg': '#000' } }), host({ t: 'session', sessionId: 's1', model: 'm', cwd: 'c' })]);
    expect(s.theme).toEqual({ '--vsc-bg': '#000' });
    expect(s.sessionId).toBe('s1');
    expect(s.model).toBe('m');
  });

  test('user_send adds a user item and marks running', () => {
    const s = run([send('hello', 1000)]);
    expect(s.running).toBe(true);
    expect(s.items).toEqual([{ kind: 'user', id: 'local-1', text: 'hello', at: 1000 }]);
  });

  test('user_send ignored while running', () => {
    const s1 = run([send('one')]);
    const s2 = reducer(s1, send('two'));
    expect(s2).toBe(s1);
  });

  test('blank user_send is ignored', () => {
    expect(reducer(initialState, send('   '))).toBe(initialState);
  });

  test('blocks stream into items', () => {
    const s = run([
      host({ t: 'block_start', key: 'm:0', kind: 'thinking' }),
      host({ t: 'block_delta', key: 'm:0', text: 'hmm' }),
      host({ t: 'block_start', key: 'm:1', kind: 'text' }),
      host({ t: 'block_delta', key: 'm:1', text: 'Hel' }),
      host({ t: 'block_delta', key: 'm:1', text: 'lo' }),
    ]);
    expect(s.items).toMatchObject([
      { kind: 'thinking', id: 'm:0', text: 'hmm' },
      { kind: 'text', id: 'm:1', text: 'Hello' },
    ]);
  });

  test('thinking records when it started and when the next block began', () => {
    const s = run([
      host({ t: 'block_start', key: 'm:0', kind: 'thinking' }, 1000),
      host({ t: 'block_delta', key: 'm:0', text: 'hmm' }, 2000),
      host({ t: 'block_start', key: 'm:1', kind: 'text' }, 4200),
      host({ t: 'block_delta', key: 'm:1', text: 'x' }, 5000),
      host({ t: 'block_start', key: 'm:2', kind: 'tool_use', toolUseId: 'tu', name: 'Read' }, 6000),
    ]);
    expect(s.items[0]).toMatchObject({ kind: 'thinking', startedAt: 1000, endedAt: 4200 });
  });

  test('thinking stays open while streaming', () => {
    const s = run([host({ t: 'block_start', key: 'm:0', kind: 'thinking' }, 1000), host({ t: 'block_delta', key: 'm:0', text: 'hmm' }, 2000)]);
    expect(s.items[0]).toMatchObject({ startedAt: 1000 });
    expect((s.items[0] as { endedAt?: number }).endedAt).toBeUndefined();
  });

  test('turn_end closes an open thinking block', () => {
    const s = run([send('q', 500), host({ t: 'block_start', key: 'm:0', kind: 'thinking' }, 1000), host({ t: 'turn_end', status: 'success' }, 3000)]);
    expect(s.items[1]).toMatchObject({ kind: 'thinking', startedAt: 1000, endedAt: 3000 });
  });

  test('a closed thinking block keeps its end time', () => {
    const s = run([
      host({ t: 'block_start', key: 'm:0', kind: 'thinking' }, 1000),
      host({ t: 'block_start', key: 'm:1', kind: 'text' }, 2000),
      host({ t: 'block_start', key: 'm:2', kind: 'thinking' }, 3000),
      host({ t: 'turn_end', status: 'success' }, 9000),
    ]);
    expect(s.items[0]).toMatchObject({ startedAt: 1000, endedAt: 2000 });
    expect(s.items[2]).toMatchObject({ startedAt: 3000, endedAt: 9000 });
  });

  test('the first reply item after a user message is stamped with its time', () => {
    const s = run([
      send('q', 100),
      host({ t: 'block_start', key: 'm:0', kind: 'text' }, 700),
      host({ t: 'block_start', key: 'm:1', kind: 'tool_use', toolUseId: 'tu', name: 'Read' }, 800),
      host({ t: 'turn_end', status: 'success' }, 900),
      send('again', 1000),
      host({ t: 'tool_input', toolUseId: 'tu2', name: 'Grep', input: {} }, 1100),
    ]);
    expect(s.items.map((i) => i.at)).toEqual([100, 700, undefined, 1000, 1100]);
  });

  test('a fatal error closes an open thinking block', () => {
    const s = run([host({ t: 'block_start', key: 'm:0', kind: 'thinking' }, 1000), host({ t: 'error', code: 'fatal', message: 'boom' }, 2500)]);
    expect(s.items[0]).toMatchObject({ kind: 'thinking', startedAt: 1000, endedAt: 2500 });
  });

  test('a notice that answers a user message is stamped', () => {
    const s = run([send('q', 100), host({ t: 'turn_end', status: 'error', error: 'Overloaded' }, 400)]);
    expect(s.items[1]).toMatchObject({ kind: 'notice', at: 400 });
  });

  test('tool card lifecycle: start, input, result', () => {
    const s = run([
      host({ t: 'block_start', key: 'm:2', kind: 'tool_use', toolUseId: 'tu1', name: 'Read' }),
      host({ t: 'tool_input', toolUseId: 'tu1', name: 'Read', input: { file_path: 'a.cs' } }),
      host({ t: 'tool_result', toolUseId: 'tu1', content: 'text', isError: false, truncated: false }),
    ]);
    expect(s.items).toEqual([{ kind: 'tool', id: 'm:2', toolUseId: 'tu1', name: 'Read', input: { file_path: 'a.cs' }, result: 'text', truncated: false, status: 'ok' }]);
  });

  test('tool_input without a start creates the card', () => {
    const s = run([host({ t: 'tool_input', toolUseId: 'tu5', name: 'Grep', input: { pattern: 'x' } })]);
    expect(s.items[0]).toMatchObject({ kind: 'tool', toolUseId: 'tu5', name: 'Grep', status: 'running' });
  });

  test('tool_result stores truncated flag and error status', () => {
    const s = run([
      host({ t: 'block_start', key: 'k', kind: 'tool_use', toolUseId: 'tu1', name: 'Read' }),
      host({ t: 'tool_result', toolUseId: 'tu1', content: 'x', isError: true, truncated: true }),
    ]);
    expect(s.items[0]).toMatchObject({ status: 'error', truncated: true });
  });

  test('turn_end success stops running without a notice', () => {
    const s = run([send('q'), host({ t: 'turn_end', status: 'success' })]);
    expect(s.running).toBe(false);
    expect(s.items.map((i) => i.kind)).toEqual(['user']);
  });

  test('turn_end interrupted marks running tools and adds an info notice', () => {
    const s = run([
      send('q'),
      host({ t: 'block_start', key: 'k', kind: 'tool_use', toolUseId: 'tu1', name: 'Read' }),
      host({ t: 'turn_end', status: 'interrupted' }),
    ]);
    expect(s.running).toBe(false);
    expect(s.items[1]).toMatchObject({ kind: 'tool', status: 'error', result: 'Interrupted' });
    expect(s.items[2]).toMatchObject({ kind: 'notice', level: 'info', text: 'Interrupted' });
  });

  test('turn_end interrupted with a reason shows it', () => {
    const s = run([send('q'), host({ t: 'turn_end', status: 'interrupted', error: 'Session disconnected' })]);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Interrupted: Session disconnected' });
  });

  test('turn_end error adds an error notice', () => {
    const s = run([send('q'), host({ t: 'turn_end', status: 'error', error: 'Overloaded' })]);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'Overloaded' });
  });

  test('fatal error adds a notice and stops running', () => {
    const s = run([send('q'), host({ t: 'error', code: 'fatal', message: 'boom' })]);
    expect(s.running).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'boom' });
    expect(s.setup).toBeUndefined();
  });

  test('clear resets the conversation but keeps connection and theme', () => {
    const s = run([
      host({ t: 'status', state: 'connected' }),
      host({ t: 'theme', vars: { a: 'b' } }),
      send('q'),
      { type: 'clear' },
    ]);
    expect(s.items).toEqual([]);
    expect(s.running).toBe(false);
    expect(s.sessionId).toBeUndefined();
    expect(s.connection).toBe('connected');
    expect(s.theme).toEqual({ a: 'b' });
  });

  test('workspace change clears the transcript', () => {
    const s = run([
      host({ t: 'session', sessionId: 's1', model: 'm', cwd: 'c' }),
      send('q'),
      host({ t: 'status', state: 'starting', detail: 'workspace_changed' }),
    ]);
    expect(s.items).toEqual([]);
    expect(s.running).toBe(false);
    expect(s.sessionId).toBeUndefined();
    expect(s.connection).toBe('starting');
  });

  test('unknown block delta is ignored', () => {
    expect(run([host({ t: 'block_delta', key: 'nope', text: 'x' })]).items).toEqual([]);
  });
});

describe('reducer permissions and mode', () => {
  const request: HostToWebview = { t: 'permission_request', id: 'p1', kind: 'edit', toolName: 'Edit', input: {}, path: 'a.cs' };

  test('permission_request appends a pending permission item', () => {
    const s = run([send('hi', 1), host(request, 5)]);
    const item = s.items.at(-1)!;
    expect(item).toMatchObject({ kind: 'permission', id: 'p1', at: 5 });
    expect((item as { outcome?: string }).outcome).toBeUndefined();
  });

  test('permission_resolved sets the outcome', () => {
    const s = run([host(request), host({ t: 'permission_resolved', id: 'p1', outcome: 'allowed' })]);
    expect(s.items[0]).toMatchObject({ kind: 'permission', outcome: 'allowed' });
  });

  test('mode event sets the mode', () => {
    expect(run([host({ t: 'mode', mode: 'plan' })]).mode).toBe('plan');
  });

  test('notice does not stop a running turn', () => {
    const s = run([send('hi'), host({ t: 'notice', level: 'error', text: 'careful' })]);
    expect(s.running).toBe(true);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'careful' });
  });

  test('turn_end cancels unresolved permission items', () => {
    const resolved: HostToWebview = { ...request, id: 'p2' };
    const s = run([
      send('hi'), host(request), host(resolved), host({ t: 'permission_resolved', id: 'p2', outcome: 'denied' }),
      host({ t: 'turn_end', status: 'success' }),
    ]);
    const outcomes = s.items.filter((i) => i.kind === 'permission').map((i) => (i as { outcome?: string }).outcome);
    expect(outcomes).toEqual(['cancelled', 'denied']);
  });

  test('fatal error, workspace change and clear cancel pending requests', () => {
    const fatal = run([host(request), host({ t: 'error', code: 'fatal', message: 'boom' })]);
    expect(fatal.items[0]).toMatchObject({ kind: 'permission', outcome: 'cancelled' });
    const cleared = run([host(request), { type: 'clear' }]);
    expect(cleared.items).toEqual([]);
    const ws = run([host(request), host({ t: 'status', state: 'connected', detail: 'workspace_changed' })]);
    expect(ws.items).toEqual([]);
  });

  test('prepare_edit is ignored', () => {
    const s = run([host({ t: 'prepare_edit', id: 'x', path: 'a' })]);
    expect(s).toEqual(initialState);
  });
});
