import type { HostToWebview, WebviewCommand } from '../../protocol/src/index';
import type { HostApi } from './host';

// Browser-only stand-in for the VS host so the UI can be styled with `npm run dev`.
export function createMockHost(): HostApi {
  let listener: ((m: HostToWebview) => void) | null = null;
  let n = 0;
  const emit = (m: HostToWebview, delay: number) => setTimeout(() => listener?.(m), delay);

  function reply() {
    const id = `mock${++n}`;
    const script: HostToWebview[] = [
      { t: 'block_start', key: `${id}:0`, kind: 'thinking' },
      { t: 'block_delta', key: `${id}:0`, text: 'The user wants an overview. I should read Program.cs first.' },
      { t: 'block_start', key: `${id}:1`, kind: 'text' },
      { t: 'block_delta', key: `${id}:1`, text: "I'll take a look at the entry point." },
      { t: 'block_start', key: `${id}:2`, kind: 'tool_use', toolUseId: `${id}-tu`, name: 'Read' },
      { t: 'tool_input', toolUseId: `${id}-tu`, name: 'Read', input: { file_path: 'C:\\src\\App\\Program.cs' } },
      { t: 'tool_result', toolUseId: `${id}-tu`, content: 'static void Main(string[] args)\n{\n    Run();\n}', isError: false, truncated: false },
      { t: 'block_start', key: `${id}:3`, kind: 'text' },
      { t: 'block_delta', key: `${id}:3`, text: '`Main` just calls **Run**:\n\n```csharp\nstatic void Main(string[] args)\n{\n    Run();\n}\n```\n\n- Startup is in `Run()`\n- No arguments are parsed' },
      { t: 'turn_end', status: 'success', durationMs: 2100 },
    ];
    script.forEach((m, i) => emit(m, 150 * (i + 1)));
  }

  // Demo requests so the permission cards can be styled in the browser; keyed off words in the message.
  function request(text: string) {
    const id = `perm${++n}`;
    const t = text.toLowerCase();
    if (t.includes('edit')) {
      emit({
        t: 'permission_request', id, kind: 'edit', toolName: 'Edit', input: {}, path: 'C:\\src\\App\\Program.cs',
        original: 'static void Main()\n{\n    Run();\n}\n', proposed: 'static void Main(string[] args)\n{\n    Run(args);\n}\n',
        isNewFile: false, tooLarge: false,
      }, 200);
    } else if (t.includes('run')) {
      emit({ t: 'permission_request', id, kind: 'tool', toolName: 'Bash', input: { command: 'dotnet test' }, suggestions: [{ label: 'dotnet test', index: 0 }] }, 200);
    } else if (t.includes('plan')) {
      emit({ t: 'permission_request', id, kind: 'plan', toolName: 'ExitPlanMode', input: {}, plan: '1. Add the parser\n2. Wire it into `Run`\n3. Cover it with tests' }, 200);
    } else if (t.includes('ask')) {
      emit({
        t: 'permission_request', id, kind: 'question', toolName: 'AskUserQuestion', input: {},
        questions: [
          { question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'SQLite', description: 'Embedded' }, { label: 'Postgres' }] },
          { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Logging' }, { label: 'Metrics', description: 'Prometheus' }] },
        ],
      }, 200);
    }
  }

  return {
    post(cmd: WebviewCommand) {
      if (cmd.t === 'webview_ready' || cmd.t === 'reconnect') {
        emit({ t: 'status', state: 'connected' }, 50);
        emit({ t: 'session', sessionId: 'mock-session', model: 'claude-opus-5-5', cwd: 'C:\\src\\App' }, 60);
      }
      if (cmd.t === 'send') {
        reply();
        request(cmd.text);
      }
      if (cmd.t === 'permission_response') {
        emit({ t: 'permission_resolved', id: cmd.id, outcome: cmd.decision === 'deny' ? 'denied' : 'allowed' }, 50);
      }
      if (cmd.t === 'interrupt') emit({ t: 'turn_end', status: 'interrupted' }, 50);
    },
    subscribe(fn) {
      listener = fn;
      return () => { listener = null; };
    },
  };
}
