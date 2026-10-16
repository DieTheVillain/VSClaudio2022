import { expect, test } from 'bun:test';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { SessionController, type QueryLike } from '../src/session';
import { PROTOCOL_VERSION, type SidecarEvent } from '../../protocol/src/index';

// A fake SDK query: records options, exposes the prompt stream, lets the test push SDK messages.
class FakeQuery implements QueryLike {
  options: Options;
  prompts: SDKUserMessage[] = [];
  interrupted = 0;
  closed = false;
  modeCalls: string[] = [];
  modeError: Error | null = null;
  private queue: any[] = [];
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  constructor(prompt: AsyncIterable<SDKUserMessage>, options: Options) {
    this.options = options;
    (async () => { for await (const p of prompt) this.prompts.push(p); })();
  }
  push(msg: any) { this.queue.push(msg); this.wake?.(); }
  fail(err: Error) { this.failure = err; this.wake?.(); }
  async interrupt() { this.interrupted++; return {}; }
  async setPermissionMode(mode: string) {
    this.modeCalls.push(mode);
    if (this.modeError) throw this.modeError;
  }
  close() { this.closed = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      if (this.failure) throw this.failure;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

function setup(claude: string | null = 'C:\\claude.exe', trusted = true) {
  const events: SidecarEvent[] = [];
  const queries: FakeQuery[] = [];
  const exits: number[] = [];
  const ctl = new SessionController({
    query: ({ prompt, options }) => { const q = new FakeQuery(prompt, options); queries.push(q); return q; },
    emit: (e) => events.push(e),
    findClaude: () => claude,
    isTrusted: () => trusted,
    log: () => {},
    readFile: () => null,
    exit: (code) => exits.push(code),
  });
  return { ctl, events, queries, exits };
}
const toolOpts = (id = 'u1') => ({ signal: new AbortController().signal, toolUseID: id }) as any;
const tick = () => new Promise((r) => setTimeout(r, 10));

test('hello without claude reports claude_not_found and starts nothing', async () => {
  const { ctl, events, queries } = setup(null);
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  expect(events).toEqual([{ t: 'error', code: 'claude_not_found', message: expect.stringContaining('Claude Code was not found') }]);
  expect(queries.length).toBe(0);
});

test('hello with the wrong protocol reports protocol_mismatch', async () => {
  const { ctl, events } = setup();
  await ctl.handle({ t: 'hello', protocol: 99, cwd: 'C:\\w' });
  expect(events[0]).toMatchObject({ t: 'error', code: 'protocol_mismatch' });
});

test('hello starts a session with the right options', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w', resume: 'abc' });
  expect(events).toEqual([{ t: 'ready', protocol: PROTOCOL_VERSION }]);
  const o = queries[0].options;
  expect(o.cwd).toBe('C:\\w');
  expect(o.pathToClaudeCodeExecutable).toBe('C:\\claude.exe');
  expect(o.includePartialMessages).toBe(true);
  expect(o.permissionMode).toBe('default');
  expect(o.resume).toBe('abc');
});

test('send pushes a human user message and SDK output is translated', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  await ctl.handle({ t: 'send', text: 'hi 🚀' });
  await tick();
  expect(queries[0].prompts[0]).toMatchObject({ type: 'user', message: { role: 'user', content: 'hi 🚀' }, parent_tool_use_id: null, origin: { kind: 'human' } });
  queries[0].push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3, total_cost_usd: 0 });
  await tick();
  expect(events.at(-1)).toEqual({ t: 'turn_end', status: 'success', durationMs: 3, costUsd: 0 });
});

test('interrupt calls the SDK and the following error result reads as interrupted', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  await ctl.handle({ t: 'interrupt' });
  expect(queries[0].interrupted).toBe(1);
  queries[0].push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 1, result: '' });
  await tick();
  expect(events.at(-1)).toEqual({ t: 'turn_end', status: 'interrupted', durationMs: 1 });
});

test('new_session closes the old query, starts a fresh one without resume, and ignores stale output', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w', resume: 'old' });
  await ctl.handle({ t: 'new_session' });
  expect(queries[0].closed).toBe(true);
  expect(queries[1].options.resume).toBeUndefined();
  const before = events.length;
  queries[0].push({ type: 'system', subtype: 'init', session_id: 'stale', model: 'm', cwd: 'c', parent_tool_use_id: null });
  await tick();
  expect(events.length).toBe(before);
});

test('send before hello reports a fatal error', async () => {
  const { ctl, events } = setup();
  await ctl.handle({ t: 'send', text: 'x' });
  expect(events[0]).toMatchObject({ t: 'error', code: 'fatal' });
});

test('a query that dies with a login error reports not_logged_in and keeps the sidecar running', async () => {
  const { ctl, events, queries, exits } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  queries[0].fail(new Error('Invalid API key · Please run /login'));
  await tick();
  expect(events.at(-1)).toMatchObject({ t: 'error', code: 'not_logged_in' });
  expect(exits).toEqual([]);
});

test('a query that dies otherwise reports fatal, then exits non-zero', async () => {
  const { ctl, events, queries, exits } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  queries[0].fail(new Error('Claude Code process exited with code 1'));
  await tick();
  expect(events.at(-1)).toMatchObject({ t: 'error', code: 'fatal', message: expect.stringContaining('exited with code 1') });
  expect(exits).toHaveLength(1);
  expect(exits[0]).not.toBe(0);
});

test('the active query ending normally exits non-zero', async () => {
  const { ctl, queries, exits } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  queries[0].close();
  await tick();
  expect(exits).toHaveLength(1);
  expect(exits[0]).not.toBe(0);
});

test('a replaced query ending or failing does not exit', async () => {
  const { ctl, queries, exits } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  await ctl.handle({ t: 'new_session' });
  queries[0].fail(new Error('late failure'));
  await tick();
  await ctl.handle({ t: 'shutdown' });
  await tick();
  expect(exits).toEqual([]);
});

test('hello passes canUseTool and a PreToolUse hook (no allowlist)', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  const o = queries[0].options;
  expect(typeof o.canUseTool).toBe('function');
  // The query's canUseTool must be the broker's: a request through it is resolved by permission_response.
  const pending = o.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  const req = events.find((e) => e.t === 'permission_request') as any;
  await ctl.handle({ t: 'permission_response', id: req.id, decision: 'allow' } as any);
  expect(await pending).toMatchObject({ behavior: 'allow' });
  expect(o.disallowedTools).toBeUndefined();
  expect(o.hooks?.PreToolUse?.length).toBe(1);
  const hook = o.hooks!.PreToolUse![0].hooks[0];
  const input = { hook_event_name: 'PreToolUse', tool_name: 'mcp__x__y', tool_input: {}, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: 'C:\\w' } as any;
  expect(await hook(input, 't1', { signal: new AbortController().signal })).toEqual({});
});

test('permission_response is routed to the broker', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  const result = queries[0].options.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  const req = events.find((e) => e.t === 'permission_request') as any;
  expect(req).toMatchObject({ toolName: 'Bash' });
  await ctl.handle({ t: 'permission_response', id: req.id, decision: 'allow' } as any);
  expect(await result).toMatchObject({ behavior: 'allow' });
  expect(events.at(-1)).toMatchObject({ t: 'permission_resolved', id: req.id, outcome: 'allowed' });
});

test('edit_prepared acks the gate', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  const hook = queries[0].options.hooks!.PreToolUse![0].hooks[0];
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.ts' }, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: 'C:\\w' } as any;
  let done = false;
  const run = hook(input, 't1', { signal: new AbortController().signal }).then(() => { done = true; });
  await tick();
  const prep = events.find((e) => e.t === 'prepare_edit') as any;
  expect(prep).toMatchObject({ path: 'C:\\w\\a.ts' });
  expect(done).toBe(false);
  await ctl.handle({ t: 'edit_prepared', id: prep.id });
  await run;
  expect(done).toBe(true);
});

test('set_mode switches and emits mode', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  await ctl.handle({ t: 'set_mode', mode: 'acceptEdits' });
  expect(queries[0].modeCalls).toEqual(['acceptEdits']);
  expect(events.at(-1)).toEqual({ t: 'mode', mode: 'acceptEdits' });
});

test('set_mode failure emits a notice and the previous mode', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  await ctl.handle({ t: 'set_mode', mode: 'plan' });
  queries[0].modeError = new Error('not allowed');
  await ctl.handle({ t: 'set_mode', mode: 'auto' });
  expect(events.slice(-2)).toEqual([
    { t: 'notice', level: 'error', text: "Auto mode isn't available: not allowed" },
    { t: 'mode', mode: 'plan' },
  ]);
});

test('new_session cancels pending requests', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  const result = queries[0].options.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  await ctl.handle({ t: 'new_session' });
  expect(await result).toMatchObject({ behavior: 'deny' });
  expect(events.find((e) => e.t === 'permission_resolved')).toMatchObject({ outcome: 'cancelled' });
});

test('hello in an untrusted folder reports untrusted_folder and starts nothing', async () => {
  const { ctl, events, queries } = setup('C:\\claude.exe', false);
  await ctl.handle({ t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' });
  expect(events).toEqual([{ t: 'error', code: 'untrusted_folder', message: expect.stringContaining("This folder hasn't been trusted") }]);
  expect((events[0] as any).message).toContain('C:\\w');
  expect(queries.length).toBe(0);
});

const HELLO = { t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\w' } as const;
const resolvedEvents = (events: SidecarEvent[]) => events.filter((e) => e.t === 'permission_resolved');

test('shutdown cancels pending requests', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle(HELLO);
  const result = queries[0].options.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  await ctl.handle({ t: 'shutdown' });
  expect(await result).toMatchObject({ behavior: 'deny' });
  expect(resolvedEvents(events)).toMatchObject([{ outcome: 'cancelled' }]);
});

test('a second hello cancels pending requests', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle(HELLO);
  const result = queries[0].options.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  await ctl.handle(HELLO);
  expect(queries.length).toBe(2);
  expect(await result).toMatchObject({ behavior: 'deny' });
  expect(resolvedEvents(events)).toMatchObject([{ outcome: 'cancelled' }]);
});

test('stale permission_response after new_session is ignored', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle(HELLO);
  const first = queries[0].options.canUseTool!('Bash', { command: 'ls' }, toolOpts());
  const staleId = (events.find((e) => e.t === 'permission_request') as any).id;
  await ctl.handle({ t: 'new_session' });
  expect(await first).toMatchObject({ behavior: 'deny' });
  const second = queries[1].options.canUseTool!('Bash', { command: 'pwd' }, toolOpts('u2'));
  const before = events.length;
  await ctl.handle({ t: 'permission_response', id: staleId, decision: 'allow' } as any);
  expect(events.length).toBe(before);
  // The new query's own request is untouched and still resolvable.
  const liveId = (events.filter((e) => e.t === 'permission_request').at(-1) as any).id;
  expect(liveId).not.toBe(staleId);
  await ctl.handle({ t: 'permission_response', id: liveId, decision: 'allow' } as any);
  expect(await second).toMatchObject({ behavior: 'allow' });
});

test('stale edit_prepared after new_session is ignored', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle(HELLO);
  const hook = queries[0].options.hooks!.PreToolUse![0].hooks[0];
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.ts' }, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: 'C:\\w' } as any;
  void hook(input, 't1', { signal: new AbortController().signal });
  await tick();
  const prep = events.find((e) => e.t === 'prepare_edit') as any;
  await ctl.handle({ t: 'new_session' });
  const before = events.length;
  await ctl.handle({ t: 'edit_prepared', id: prep.id });
  expect(events.length).toBe(before);
});
