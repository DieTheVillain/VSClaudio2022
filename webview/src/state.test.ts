import { describe, expect, test } from 'vitest';
import { initialState, reducer, type Action, type ChatState } from './state';
import type { HostToWebview } from '../../protocol/src/index';

const host = (msg: HostToWebview): Action => ({ type: 'host', msg });
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
    const s = run([{ type: 'user_send', text: 'hello' }]);
    expect(s.running).toBe(true);
    expect(s.items).toEqual([{ kind: 'user', id: 'local-1', text: 'hello' }]);
  });

  test('user_send ignored while running', () => {
    const s1 = run([{ type: 'user_send', text: 'one' }]);
    const s2 = reducer(s1, { type: 'user_send', text: 'two' });
    expect(s2).toBe(s1);
  });

  test('blank user_send is ignored', () => {
    expect(reducer(initialState, { type: 'user_send', text: '   ' })).toBe(initialState);
  });

  test('blocks stream into items', () => {
    const s = run([
      host({ t: 'block_start', key: 'm:0', kind: 'thinking' }),
      host({ t: 'block_delta', key: 'm:0', text: 'hmm' }),
      host({ t: 'block_start', key: 'm:1', kind: 'text' }),
      host({ t: 'block_delta', key: 'm:1', text: 'Hel' }),
      host({ t: 'block_delta', key: 'm:1', text: 'lo' }),
    ]);
    expect(s.items).toEqual([
      { kind: 'thinking', id: 'm:0', text: 'hmm' },
      { kind: 'text', id: 'm:1', text: 'Hello' },
    ]);
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
    const s = run([{ type: 'user_send', text: 'q' }, host({ t: 'turn_end', status: 'success' })]);
    expect(s.running).toBe(false);
    expect(s.items.map((i) => i.kind)).toEqual(['user']);
  });

  test('turn_end interrupted marks running tools and adds an info notice', () => {
    const s = run([
      { type: 'user_send', text: 'q' },
      host({ t: 'block_start', key: 'k', kind: 'tool_use', toolUseId: 'tu1', name: 'Read' }),
      host({ t: 'turn_end', status: 'interrupted' }),
    ]);
    expect(s.running).toBe(false);
    expect(s.items[1]).toMatchObject({ kind: 'tool', status: 'error', result: 'Interrupted' });
    expect(s.items[2]).toMatchObject({ kind: 'notice', level: 'info', text: 'Interrupted' });
  });

  test('turn_end interrupted with a reason shows it', () => {
    const s = run([{ type: 'user_send', text: 'q' }, host({ t: 'turn_end', status: 'interrupted', error: 'Session disconnected' })]);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Interrupted: Session disconnected' });
  });

  test('turn_end error adds an error notice', () => {
    const s = run([{ type: 'user_send', text: 'q' }, host({ t: 'turn_end', status: 'error', error: 'Overloaded' })]);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'Overloaded' });
  });

  test('fatal error adds a notice and stops running', () => {
    const s = run([{ type: 'user_send', text: 'q' }, host({ t: 'error', code: 'fatal', message: 'boom' })]);
    expect(s.running).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'boom' });
    expect(s.setup).toBeUndefined();
  });

  test('clear resets the conversation but keeps connection and theme', () => {
    const s = run([
      host({ t: 'status', state: 'connected' }),
      host({ t: 'theme', vars: { a: 'b' } }),
      { type: 'user_send', text: 'q' },
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
      { type: 'user_send', text: 'q' },
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
