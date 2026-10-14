import { expect, test } from 'bun:test';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { BLOCKED_TOOLS, READ_ONLY_DENY, readOnlyDecision, SessionController, type QueryLike } from '../src/session';
import type { SidecarEvent } from '../../protocol/src/index';

// A fake SDK query: records options, exposes the prompt stream, lets the test push SDK messages.
class FakeQuery implements QueryLike {
  options: Options;
  prompts: SDKUserMessage[] = [];
  interrupted = 0;
  closed = false;
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

function setup(claude: string | null = 'C:\\claude.exe') {
  const events: SidecarEvent[] = [];
  const queries: FakeQuery[] = [];
  const ctl = new SessionController({
    query: ({ prompt, options }) => { const q = new FakeQuery(prompt, options); queries.push(q); return q; },
    emit: (e) => events.push(e),
    findClaude: () => claude,
    log: () => {},
  });
  return { ctl, events, queries };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test('hello without claude reports claude_not_found and starts nothing', async () => {
  const { ctl, events, queries } = setup(null);
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  expect(events).toEqual([{ t: 'error', code: 'claude_not_found', message: expect.stringContaining('Claude Code was not found') }]);
  expect(queries.length).toBe(0);
});

test('hello with the wrong protocol reports protocol_mismatch', async () => {
  const { ctl, events } = setup();
  await ctl.handle({ t: 'hello', protocol: 99, cwd: 'C:\\w' });
  expect(events[0]).toMatchObject({ t: 'error', code: 'protocol_mismatch' });
});

test('hello starts a read-only session with the right options', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w', resume: 'abc' });
  expect(events).toEqual([{ t: 'ready', protocol: 1 }]);
  const o = queries[0].options;
  expect(o.cwd).toBe('C:\\w');
  expect(o.pathToClaudeCodeExecutable).toBe('C:\\claude.exe');
  expect(o.includePartialMessages).toBe(true);
  expect(o.permissionMode).toBe('default');
  expect(o.resume).toBe('abc');
  expect(o.disallowedTools).toEqual([...BLOCKED_TOOLS]);
  expect(BLOCKED_TOOLS).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit']));
  const verdict = await o.canUseTool!('Write', {}, { signal: new AbortController().signal } as any);
  expect(verdict).toEqual({ behavior: 'deny', message: READ_ONLY_DENY });
});

test('send pushes a human user message and SDK output is translated', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  await ctl.handle({ t: 'send', text: 'hi 🚀' });
  await tick();
  expect(queries[0].prompts[0]).toMatchObject({ type: 'user', message: { role: 'user', content: 'hi 🚀' }, parent_tool_use_id: null, origin: { kind: 'human' } });
  queries[0].push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3, total_cost_usd: 0 });
  await tick();
  expect(events.at(-1)).toEqual({ t: 'turn_end', status: 'success', durationMs: 3, costUsd: 0 });
});

test('interrupt calls the SDK and the following error result reads as interrupted', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  await ctl.handle({ t: 'interrupt' });
  expect(queries[0].interrupted).toBe(1);
  queries[0].push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 1, result: '' });
  await tick();
  expect(events.at(-1)).toEqual({ t: 'turn_end', status: 'interrupted', durationMs: 1 });
});

test('new_session closes the old query, starts a fresh one without resume, and ignores stale output', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w', resume: 'old' });
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

test('a query that dies with a login error reports not_logged_in', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  queries[0].fail(new Error('Invalid API key · Please run /login'));
  await tick();
  expect(events.at(-1)).toMatchObject({ t: 'error', code: 'not_logged_in' });
});

test('a query that dies otherwise reports fatal', async () => {
  const { ctl, events, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  queries[0].fail(new Error('Claude Code process exited with code 1'));
  await tick();
  expect(events.at(-1)).toMatchObject({ t: 'error', code: 'fatal', message: expect.stringContaining('exited with code 1') });
});

test('readOnlyDecision allows read-only tools and denies everything else', () => {
  expect(readOnlyDecision('Read')).toEqual({ allow: true });
  for (const name of ['Monitor', 'WebFetch', 'mcp__claude_ai_Gmail__send_message']) {
    expect(readOnlyDecision(name)).toEqual({ allow: false, reason: READ_ONLY_DENY });
  }
});

test('hello installs a PreToolUse hook that denies tools outside the read-only allowlist', async () => {
  const { ctl, queries } = setup();
  await ctl.handle({ t: 'hello', protocol: 1, cwd: 'C:\\w' });
  const matchers = queries[0].options.hooks?.PreToolUse;
  expect(matchers?.length).toBe(1);
  const hook = matchers![0].hooks[0];
  const input = (tool_name: string) =>
    ({ hook_event_name: 'PreToolUse', tool_name, tool_input: {}, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: 'C:\\w' }) as any;
  const signal = { signal: new AbortController().signal };
  expect(await hook(input('mcp__x__y'), 't1', signal)).toEqual({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: READ_ONLY_DENY },
  });
  expect(await hook(input('Grep'), 't1', signal)).toEqual({});
});
