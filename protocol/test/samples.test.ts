import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type HostCommand, type HostToWebview, type SidecarEvent, type WebviewCommand } from '../src/index';
import { samples } from '../src/samples';

// Every variant must appear in the samples so the C# cross-check sees it.
const hostCommandKinds: Record<HostCommand['t'], true> = {
  hello: true, send: true, interrupt: true, new_session: true, shutdown: true, permission_response: true, set_mode: true, edit_prepared: true,
};
const sidecarEventKinds: Record<SidecarEvent['t'], true> = {
  ready: true, session: true, block_start: true, block_delta: true, tool_input: true, tool_result: true, turn_end: true, error: true,
  permission_request: true, permission_resolved: true, mode: true, notice: true, prepare_edit: true,
};
const hostOnlyKinds: Record<Exclude<HostToWebview['t'], SidecarEvent['t']>, true> = { status: true, theme: true };
const webviewCommandKinds: Record<WebviewCommand['t'], true> = {
  webview_ready: true, send: true, interrupt: true, new_session: true, reconnect: true, choose_folder: true,
  permission_response: true, set_mode: true, open_diff: true,
};

const kinds = (xs: { t: string }[]) => new Set(xs.map((x) => x.t));

test('samples cover every host command', () => {
  expect(kinds(samples.hostCommands)).toEqual(new Set(Object.keys(hostCommandKinds)));
});
test('samples cover every sidecar event', () => {
  expect(kinds(samples.sidecarEvents)).toEqual(new Set(Object.keys(sidecarEventKinds)));
});
test('samples cover every host-only webview message', () => {
  expect(kinds(samples.hostToWebview)).toEqual(new Set(Object.keys(hostOnlyKinds)));
});
test('samples cover every webview command', () => {
  expect(kinds(samples.webviewCommands)).toEqual(new Set(Object.keys(webviewCommandKinds)));
});
test('fixture file is up to date', () => {
  const onDisk = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'samples.json'), 'utf8'));
  expect(onDisk).toEqual({ protocolVersion: PROTOCOL_VERSION, ...samples });
});
