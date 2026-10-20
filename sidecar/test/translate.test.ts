import { expect, test } from 'bun:test';
import { flatten, isLoginError, MAX_TOOL_RESULT_CHARS, Translator } from '../src/translate';

const init = { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5-5', cwd: 'C:\\a', parent_tool_use_id: null };
const stream = (event: unknown) => ({ type: 'stream_event', event, parent_tool_use_id: null });

test('init becomes a session event', () => {
  expect(new Translator().translate(init)).toEqual([{ t: 'session', sessionId: 's1', model: 'claude-opus-5-5', cwd: 'C:\\a' }]);
});

test('init also emits the permission mode', () => {
  expect(new Translator().translate({ ...init, permissionMode: 'acceptEdits' })).toEqual([
    { t: 'session', sessionId: 's1', model: 'claude-opus-5-5', cwd: 'C:\\a' },
    { t: 'mode', mode: 'acceptEdits' },
  ]);
});

test('init with an unknown permission mode emits no mode', () => {
  const out = new Translator().translate({ ...init, permissionMode: 'bypassPermissions' });
  expect(out.map((e) => e.t)).toEqual(['session']);
});

test('status message with a known permissionMode emits mode', () => {
  const status = { type: 'system', subtype: 'status', status: null, permissionMode: 'plan', uuid: 'u1', session_id: 's1', parent_tool_use_id: null };
  expect(new Translator().translate(status)).toEqual([{ t: 'mode', mode: 'plan' }]);
});

test('unknown mode emits nothing', () => {
  const tr = new Translator();
  const status = { type: 'system', subtype: 'status', status: null, uuid: 'u1', session_id: 's1', parent_tool_use_id: null };
  expect(tr.translate({ ...status, permissionMode: 'bypassPermissions' })).toEqual([]);
  expect(tr.translate(status)).toEqual([]);
});

test('streamed text and thinking become block_start/block_delta keyed by message and index', () => {
  const tr = new Translator();
  const out = [
    stream({ type: 'message_start', message: { id: 'm1' } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } }),
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } }),
  ].flatMap((m) => tr.translate(m));
  expect(out).toEqual([
    { t: 'block_start', key: 'm1:0', kind: 'thinking' },
    { t: 'block_delta', key: 'm1:0', text: 'hmm' },
    { t: 'block_start', key: 'm1:1', kind: 'text' },
    { t: 'block_delta', key: 'm1:1', text: 'Hel' },
    { t: 'block_delta', key: 'm1:1', text: 'lo' },
  ]);
});

test('streamed tool_use starts a card; the assistant message supplies its input', () => {
  const tr = new Translator();
  tr.translate(stream({ type: 'message_start', message: { id: 'm2' } }));
  expect(tr.translate(stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } })))
    .toEqual([{ t: 'block_start', key: 'm2:0', kind: 'tool_use', toolUseId: 'tu1', name: 'Read' }]);
  const assistant = { type: 'assistant', parent_tool_use_id: null, message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.cs' } }] } };
  expect(tr.translate(assistant)).toEqual([{ t: 'tool_input', toolUseId: 'tu1', name: 'Read', input: { file_path: 'a.cs' } }]);
});

test('a streamed message does not repeat its text from the assistant message', () => {
  const tr = new Translator();
  tr.translate(stream({ type: 'message_start', message: { id: 'm3' } }));
  expect(tr.translate({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm3', content: [{ type: 'text', text: 'Hello' }] } })).toEqual([]);
});

test('a never-streamed message is emitted whole', () => {
  const tr = new Translator();
  const out = tr.translate({
    type: 'assistant', parent_tool_use_id: null,
    message: { id: 'm4', content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 'tu9', name: 'Grep', input: { pattern: 'x' } }] },
  });
  expect(out).toEqual([
    { t: 'block_start', key: 'm4:full:0', kind: 'text' },
    { t: 'block_delta', key: 'm4:full:0', text: 'Hi' },
    { t: 'block_start', key: 'm4:tool:tu9', kind: 'tool_use', toolUseId: 'tu9', name: 'Grep' },
    { t: 'tool_input', toolUseId: 'tu9', name: 'Grep', input: { pattern: 'x' } },
  ]);
});

test('split unstreamed messages sharing an id get distinct block keys', () => {
  const tr = new Translator();
  const out = [
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'm5', content: [{ type: 'thinking', thinking: 't' }] } },
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'm5', content: [{ type: 'text', text: 'x' }] } },
  ].flatMap((m) => tr.translate(m));
  expect(out).toEqual([
    { t: 'block_start', key: 'm5:full:0', kind: 'thinking' },
    { t: 'block_delta', key: 'm5:full:0', text: 't' },
    { t: 'block_start', key: 'm5:full:1', kind: 'text' },
    { t: 'block_delta', key: 'm5:full:1', text: 'x' },
  ]);
});

test('tool results come from user messages', () => {
  const out = new Translator().translate({
    type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu1', content: 'file text', is_error: false },
      { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: 'denied' }], is_error: true },
    ] },
  });
  expect(out).toEqual([
    { t: 'tool_result', toolUseId: 'tu1', content: 'file text', isError: false, truncated: false },
    { t: 'tool_result', toolUseId: 'tu2', content: 'denied', isError: true, truncated: false },
  ]);
});

test('subagent traffic is dropped', () => {
  const tr = new Translator();
  expect(tr.translate({ type: 'stream_event', parent_tool_use_id: 'task1', event: { type: 'message_start', message: { id: 'x' } } })).toEqual([]);
  expect(tr.translate({ type: 'assistant', parent_tool_use_id: 'task1', message: { id: 'x', content: [{ type: 'text', text: 'sub' }] } })).toEqual([]);
});

test('result success becomes turn_end success', () => {
  expect(new Translator().translate({ type: 'result', subtype: 'success', is_error: false, duration_ms: 50, total_cost_usd: 0.002, result: 'ok' }))
    .toEqual([{ t: 'turn_end', status: 'success', durationMs: 50, costUsd: 0.002 }]);
});

test('an error result after markInterrupt is an interruption, and the flag resets', () => {
  const tr = new Translator();
  tr.markInterrupt();
  const err = { type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 9, result: '' };
  expect(tr.translate(err)).toEqual([{ t: 'turn_end', status: 'interrupted', durationMs: 9 }]);
  expect(tr.translate(err)).toEqual([{ t: 'turn_end', status: 'error', error: 'Turn failed (error_during_execution)', durationMs: 9 }]);
});

test('a login failure also raises not_logged_in', () => {
  const out = new Translator().translate({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1, result: 'Invalid API key · Please run /login' });
  expect(out).toEqual([
    { t: 'turn_end', status: 'error', error: 'Invalid API key · Please run /login', durationMs: 1 },
    { t: 'error', code: 'not_logged_in', message: 'Invalid API key · Please run /login' },
  ]);
});

test('flatten truncates long output', () => {
  const r = flatten('x'.repeat(MAX_TOOL_RESULT_CHARS + 10));
  expect(r.text.length).toBe(MAX_TOOL_RESULT_CHARS);
  expect(r.truncated).toBe(true);
});

test('flatten joins text blocks and marks images', () => {
  expect(flatten([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toEqual({ text: 'a\n[image]\nb', truncated: false });
});

test('isLoginError', () => {
  expect(isLoginError('Please run /login')).toBe(true);
  expect(isLoginError('Not logged in')).toBe(true);
  expect(isLoginError('Overloaded')).toBe(false);
});
