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
    { t: 'permission_response', id: 'perm_1', decision: 'deny', message: 'The user rejected this.' },
    { t: 'permission_response', id: 'perm_2', decision: 'allow' },
    { t: 'set_mode', mode: 'acceptEdits' },
    { t: 'edit_prepared', id: 'perm_1' },
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
    {
      t: 'permission_request', id: 'perm_1', kind: 'edit', toolName: 'Edit', toolUseId: 'toolu_2',
      input: { file_path: 'C:\\src\\App\\Program.cs', old_string: 'A', new_string: 'B' },
      path: 'C:\\src\\App\\Program.cs', original: 'class Program { A }', proposed: 'class Program { B }', isNewFile: false, tooLarge: false,
    },
    {
      t: 'permission_request', id: 'perm_2', kind: 'tool', toolName: 'Bash', toolUseId: 'toolu_3', input: { command: 'dotnet test' },
      suggestions: [{ label: 'Always allow dotnet test', index: 0 }, { label: 'Always allow Bash in this project', index: 1 }],
    },
    {
      t: 'permission_request', id: 'perm_3', kind: 'plan', toolName: 'ExitPlanMode', toolUseId: 'toolu_4',
      input: { plan: '1. Add the type\n2. Wire it up' }, plan: '1. Add the type\n2. Wire it up',
    },
    {
      t: 'permission_request', id: 'perm_4', kind: 'question', toolName: 'AskUserQuestion', toolUseId: 'toolu_5', input: {},
      questions: [
        { question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'SQLite', description: 'Embedded' }, { label: 'Postgres' }] },
        { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Logging' }, { label: 'Metrics', description: 'Prometheus' }] },
      ],
    },
    { t: 'permission_request', id: 'perm_5', kind: 'edit', toolName: 'Write', input: {}, path: 'C:\\src\\App\\Big.bin', tooLarge: true },
    { t: 'permission_resolved', id: 'perm_1', outcome: 'allowed' },
    { t: 'permission_resolved', id: 'perm_2', outcome: 'denied' },
    { t: 'permission_resolved', id: 'perm_3', outcome: 'cancelled' },
    { t: 'mode', mode: 'plan' },
    { t: 'notice', level: 'info', text: 'Switched to plan mode.' },
    { t: 'notice', level: 'error', text: 'Could not read the file.' },
    { t: 'prepare_edit', id: 'perm_1', path: 'C:\\src\\App\\Program.cs' },
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
    {
      t: 'permission_response', id: 'perm_2', decision: 'allow_always', suggestionIndex: 0,
    },
    { t: 'permission_response', id: 'perm_3', decision: 'allow', nextMode: 'acceptEdits' },
    { t: 'permission_response', id: 'perm_4', decision: 'allow', answers: { 'Which database?': 'SQLite', 'Which extras?': 'Logging, Metrics' } },
    { t: 'set_mode', mode: 'default' },
    { t: 'open_diff', id: 'perm_1' },
  ],
};
