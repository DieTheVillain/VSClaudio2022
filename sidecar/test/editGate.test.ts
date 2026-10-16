import { expect, test } from 'bun:test';
import { EditGate } from '../src/editGate';
import type { SidecarEvent } from '../../protocol/src/index';

const input = (tool_name: string, tool_input: Record<string, unknown>) =>
  ({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't1', session_id: 's', transcript_path: '', cwd: 'C:\\w' }) as any;
const opts = { signal: new AbortController().signal };
const tick = () => new Promise((r) => setTimeout(r, 5));

function make(timeoutMs?: number) {
  const events: SidecarEvent[] = [];
  const logs: string[] = [];
  const gate = new EditGate({ emit: (e) => events.push(e), log: (s) => logs.push(s), timeoutMs, newId: () => 'p1' });
  return { gate, events, logs };
}

test('emits prepare_edit for edit tools and waits for ack', async () => {
  const { gate, events } = make();
  let done = false;
  const run = gate.hook(input('Edit', { file_path: 'C:\\w\\a.ts' }), 't1', opts).then((r) => { done = true; return r; });
  await tick();
  expect(events).toEqual([{ t: 'prepare_edit', id: 'p1', path: 'C:\\w\\a.ts' }]);
  expect(done).toBe(false);
  gate.ack('p1');
  expect(await run).toEqual({});
});

test('ignores non-edit tools', async () => {
  const { gate, events } = make();
  expect(await gate.hook(input('Read', { file_path: 'C:\\w\\a.ts' }), 't1', opts)).toEqual({});
  expect(events).toEqual([]);
});

test('proceeds after the timeout and logs', async () => {
  const { gate, events, logs } = make(20);
  expect(await gate.hook(input('Write', { file_path: 'C:\\w\\b.ts' }), 't1', opts)).toEqual({});
  expect(events).toHaveLength(1);
  expect(logs.join('')).toContain('prepare_edit');
});

test('ack for unknown id is a no-op', () => {
  const { gate } = make();
  expect(() => gate.ack('nope')).not.toThrow();
});
