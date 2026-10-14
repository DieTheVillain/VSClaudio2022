import type { HostCommand, HostToWebview, SidecarEvent, WebviewCommand } from './index';
import { PROTOCOL_VERSION } from './index';

export const samples: {
  hostCommands: HostCommand[];
  sidecarEvents: SidecarEvent[];
  hostToWebview: HostToWebview[];
  webviewCommands: WebviewCommand[];
} = {
  hostCommands: [
    { t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\src\\App', resume: 'efa798d1-42da-4c99-a7ed-5c6595a43a9b' },
    { t: 'hello', protocol: PROTOCOL_VERSION, cwd: 'C:\\src\\App' },
    { t: 'send', text: 'Explain Program.cs — café ✓ 🚀' },
    { t: 'interrupt' },
    { t: 'new_session' },
    { t: 'shutdown' },
  ],
  sidecarEvents: [
    { t: 'ready', protocol: PROTOCOL_VERSION },
    { t: 'session', sessionId: 'efa798d1-42da-4c99-a7ed-5c6595a43a9b', model: 'claude-opus-5-5', cwd: 'C:\\src\\App' },
    { t: 'block_start', key: 'msg_1:0', kind: 'text' },
    { t: 'block_start', key: 'msg_1:1', kind: 'tool_use', toolUseId: 'toolu_1', name: 'Read' },
    { t: 'block_delta', key: 'msg_1:0', text: 'Let me look.' },
    { t: 'tool_input', toolUseId: 'toolu_1', name: 'Read', input: { file_path: 'C:\\src\\App\\Program.cs' } },
    { t: 'tool_result', toolUseId: 'toolu_1', content: 'class Program {}', isError: false, truncated: false },
    { t: 'turn_end', status: 'success', durationMs: 1234, costUsd: 0.01 },
    { t: 'turn_end', status: 'error', error: 'Overloaded' },
    { t: 'error', code: 'claude_not_found', message: 'Claude Code was not found.' },
    { t: 'error', code: 'untrusted_folder', message: "This folder hasn't been trusted in Claude Code yet." },
  ],
  hostToWebview: [
    { t: 'status', state: 'connected' },
    { t: 'status', state: 'disconnected', detail: 'exit code 1' },
    { t: 'theme', vars: { '--vsc-bg': '#1F1F1F', '--vsc-fg': '#FAFAFA' } },
  ],
  webviewCommands: [
    { t: 'webview_ready' },
    { t: 'send', text: 'hi' },
    { t: 'interrupt' },
    { t: 'new_session' },
    { t: 'reconnect' },
    { t: 'choose_folder' },
  ],
};
