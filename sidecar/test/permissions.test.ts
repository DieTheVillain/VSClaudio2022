import { expect, test } from 'bun:test';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionMode, PermissionResponse, SidecarEvent } from '../../protocol/src/index';
import { DEFAULT_DENY, PermissionBroker, STALE_FILE_DENY, suggestionLabel } from '../src/permissions';

function setup(files: Record<string, string> = {}) {
  const events: SidecarEvent[] = [];
  const modes: PermissionMode[] = [];
  let n = 0;
  const broker = new PermissionBroker({
    emit: (e) => events.push(e),
    readFile: (p) => (p in files ? files[p] : null),
    setMode: async (m) => { modes.push(m); },
    newId: () => `id${++n}`,
  });
  return { broker, events, modes, files };
}

const opts = (extra: Record<string, unknown> = {}) => ({ signal: new AbortController().signal, toolUseID: 'tu1', ...extra }) as any;
const respond = (id: string, r: Partial<PermissionResponse>): PermissionResponse =>
  ({ t: 'permission_response', id, decision: 'allow', ...r }) as PermissionResponse;
const ruleUpdate = (toolName: string, ruleContent?: string): PermissionUpdate =>
  ({ type: 'addRules', rules: [{ toolName, ruleContent }], behavior: 'allow', destination: 'localSettings' }) as PermissionUpdate;
const resolved = (events: SidecarEvent[]) => events.filter((e) => e.t === 'permission_resolved');

test('tool request emits permission_request and allow resolves allow', async () => {
  const { broker, events } = setup();
  const input = { command: 'ls' };
  const p = broker.canUseTool('Bash', input, opts());
  expect(events).toEqual([{ t: 'permission_request', id: 'id1', kind: 'tool', toolName: 'Bash', toolUseId: 'tu1', input }]);
  expect(broker.pendingCount).toBe(1);
  broker.respond(respond('id1', { decision: 'allow' }));
  expect(await p).toEqual({ behavior: 'allow', updatedInput: input });
  expect(events[1]).toEqual({ t: 'permission_resolved', id: 'id1', outcome: 'allowed' });
  expect(broker.pendingCount).toBe(0);
});

test('deny uses the message or DEFAULT_DENY', async () => {
  const { broker, events } = setup();
  const a = broker.canUseTool('Bash', {}, opts());
  broker.respond(respond('id1', { decision: 'deny', message: 'nope' }));
  expect(await a).toEqual({ behavior: 'deny', message: 'nope' });
  const b = broker.canUseTool('Bash', {}, opts());
  broker.respond(respond('id2', { decision: 'deny' }));
  expect(await b).toEqual({ behavior: 'deny', message: DEFAULT_DENY });
  expect(resolved(events)).toEqual([
    { t: 'permission_resolved', id: 'id1', outcome: 'denied' },
    { t: 'permission_resolved', id: 'id2', outcome: 'denied' },
  ]);
});

test('allow_always returns the chosen suggestion as updatedPermissions', async () => {
  const { broker, events } = setup();
  const s = [ruleUpdate('Bash', 'ls:*'), ruleUpdate('Read')];
  const p = broker.canUseTool('Bash', { command: 'ls' }, opts({ suggestions: s }));
  expect((events[0] as any).suggestions).toEqual([{ label: 'Bash(ls:*)', index: 0 }, { label: 'Read', index: 1 }]);
  broker.respond(respond('id1', { decision: 'allow_always', suggestionIndex: 1 }));
  expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: [s[1]] });

  const q = broker.canUseTool('Bash', {}, opts({ suggestions: s }));
  broker.respond(respond('id2', { decision: 'allow_always' }));
  expect(((await q) as any).updatedPermissions).toEqual(s);
});

test('edit request carries path/original/proposed', async () => {
  const { broker, events } = setup({ 'a.txt': 'one two' });
  const input = { file_path: 'a.txt', old_string: 'two', new_string: '2' };
  const p = broker.canUseTool('Edit', input, opts());
  expect(events[0]).toEqual({
    t: 'permission_request', id: 'id1', kind: 'edit', toolName: 'Edit', toolUseId: 'tu1', input,
    path: 'a.txt', original: 'one two', proposed: 'one 2', isNewFile: false, tooLarge: false,
  });
  broker.respond(respond('id1', {}));
  expect(await p).toEqual({ behavior: 'allow', updatedInput: input });
});

test('edit that cannot be previewed falls back to a tool card', () => {
  const { broker, events } = setup();
  void broker.canUseTool('Edit', { file_path: 'missing.txt', old_string: 'a', new_string: 'b' }, opts());
  expect((events[0] as any).kind).toBe('tool');
});

test('stale edit is denied with STALE_FILE_DENY', async () => {
  const { broker, events, files } = setup({ 'a.txt': 'one two' });
  const p = broker.canUseTool('Edit', { file_path: 'a.txt', old_string: 'two', new_string: '2' }, opts());
  files['a.txt'] = 'changed';
  broker.respond(respond('id1', {}));
  expect(await p).toEqual({ behavior: 'deny', message: STALE_FILE_DENY });
  expect(events[1]).toEqual({ t: 'permission_resolved', id: 'id1', outcome: 'denied' });
});

test('stale new-file write is denied when the file now exists', async () => {
  const { broker, files } = setup();
  const p = broker.canUseTool('Write', { file_path: 'n.txt', content: 'x' }, opts());
  files['n.txt'] = 'surprise';
  broker.respond(respond('id1', { decision: 'allow_always' }));
  expect(await p).toEqual({ behavior: 'deny', message: STALE_FILE_DENY });
});

test('question allow passes answers in updatedInput', async () => {
  const { broker, events } = setup();
  const questions = [{ question: 'Which?', header: 'W', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }];
  const p = broker.canUseTool('AskUserQuestion', { questions }, opts());
  expect((events[0] as any).kind).toBe('question');
  expect((events[0] as any).questions).toEqual(questions);
  broker.respond(respond('id1', { answers: { 'Which?': 'A' } }));
  expect(await p).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which?': 'A' } } });
});

test('question answers: multi-select joined, Other overrides', async () => {
  const { broker } = setup();
  const p = broker.canUseTool('AskUserQuestion', { questions: [] }, opts());
  broker.respond(respond('id1', { answers: { 'Which?': 'A, B' } }));
  expect(((await p) as any).updatedInput.answers).toEqual({ 'Which?': 'A, B' });
  const q = broker.canUseTool('AskUserQuestion', { questions: [] }, opts());
  broker.respond(respond('id2', {}));
  expect(((await q) as any).updatedInput.answers).toEqual({});
});

test('plan approve sets nextMode, keep planning denies with note', async () => {
  const { broker, events, modes } = setup();
  const p = broker.canUseTool('ExitPlanMode', { plan: 'Do it' }, opts());
  expect((events[0] as any).kind).toBe('plan');
  expect((events[0] as any).plan).toBe('Do it');
  broker.respond(respond('id1', { nextMode: 'acceptEdits' }));
  expect(await p).toEqual({ behavior: 'allow', updatedInput: { plan: 'Do it' } });
  expect(modes).toEqual(['acceptEdits']);

  const q = broker.canUseTool('ExitPlanMode', {}, opts());
  expect((events.filter((e) => e.t === 'permission_request')[1] as any).plan).toBeUndefined();
  broker.respond(respond('id2', {}));
  await q;
  expect(modes).toEqual(['acceptEdits', 'default']);

  const r = broker.canUseTool('ExitPlanMode', {}, opts());
  broker.respond(respond('id3', { decision: 'deny', message: 'Add tests' }));
  expect(await r).toEqual({ behavior: 'deny', message: 'Add tests' });
  expect(modes).toHaveLength(2);
});

test('abort emits cancelled and drops the request', async () => {
  const { broker, events } = setup();
  const ac = new AbortController();
  const p = broker.canUseTool('Bash', {}, opts({ signal: ac.signal }));
  ac.abort();
  expect(await p).toEqual({ behavior: 'deny', message: 'Cancelled.' });
  expect(events[1]).toEqual({ t: 'permission_resolved', id: 'id1', outcome: 'cancelled' });
  expect(broker.pendingCount).toBe(0);
});

test('an already-aborted signal cancels immediately', async () => {
  const { broker, events } = setup();
  const ac = new AbortController();
  ac.abort();
  expect(await broker.canUseTool('Bash', {}, opts({ signal: ac.signal }))).toEqual({ behavior: 'deny', message: 'Cancelled.' });
  expect(resolved(events)).toEqual([{ t: 'permission_resolved', id: 'id1', outcome: 'cancelled' }]);
  expect(broker.pendingCount).toBe(0);
});

test('response for a cancelled or unknown id is ignored', async () => {
  const { broker, events } = setup();
  const ac = new AbortController();
  const p = broker.canUseTool('Bash', {}, opts({ signal: ac.signal }));
  ac.abort();
  await p;
  const count = events.length;
  broker.respond(respond('id1', {}));
  broker.respond(respond('nope', {}));
  expect(events).toHaveLength(count);
});

test('a duplicate response is ignored', async () => {
  const { broker, events } = setup();
  const p = broker.canUseTool('Bash', {}, opts());
  broker.respond(respond('id1', {}));
  broker.respond(respond('id1', { decision: 'deny' }));
  await p;
  expect(resolved(events)).toHaveLength(1);
});

test('resolves requests independently, in any order', async () => {
  const { broker, events } = setup();
  const a = broker.canUseTool('Bash', { n: 1 }, opts());
  const b = broker.canUseTool('Bash', { n: 2 }, opts());
  const c = broker.canUseTool('Bash', { n: 3 }, opts());
  expect(broker.pendingCount).toBe(3);
  broker.respond(respond('id3', {}));
  broker.respond(respond('id1', { decision: 'deny' }));
  expect(broker.pendingCount).toBe(1);
  broker.respond(respond('id2', {}));
  expect((await a).behavior).toBe('deny');
  expect((await b).behavior).toBe('allow');
  expect((await c).behavior).toBe('allow');
  expect(resolved(events).map((e: any) => e.id)).toEqual(['id3', 'id1', 'id2']);
});

test('cancelAll cancels every pending request', async () => {
  const { broker, events } = setup();
  const a = broker.canUseTool('Bash', {}, opts());
  const b = broker.canUseTool('Bash', {}, opts());
  broker.cancelAll();
  expect(await a).toEqual({ behavior: 'deny', message: 'Cancelled.' });
  expect(await b).toEqual({ behavior: 'deny', message: 'Cancelled.' });
  expect(resolved(events).map((e: any) => e.outcome)).toEqual(['cancelled', 'cancelled']);
  expect(broker.pendingCount).toBe(0);
});

test('suggestionLabel formats rules', () => {
  expect(suggestionLabel(ruleUpdate('Bash', 'npm test:*'))).toBe('Bash(npm test:*)');
  expect(suggestionLabel({ type: 'addRules', rules: [{ toolName: 'Read' }, { toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'session' } as PermissionUpdate)).toBe('Read, Bash(ls)');
  expect(suggestionLabel({ type: 'setMode', mode: 'acceptEdits', destination: 'session' } as PermissionUpdate)).toBe('Always allow');
});
