import type { HookCallback, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PROTOCOL_VERSION, type HostCommand, type SidecarEvent } from '../../protocol/src/index';
import { Inbox } from './inbox';
import { isLoginError, Translator } from './translate';

export interface QueryLike extends AsyncIterable<any> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type QueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryLike;

export const READ_ONLY_DENY = 'VSClaudio is read-only in this version: it cannot edit files or run commands yet.';
// Belt and braces with the deny-all canUseTool: user settings may pre-approve these tools.
export const BLOCKED_TOOLS = Object.freeze(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);

// The only tools a session may run. Everything else (MCP tools, WebFetch, mutating built-ins) is
// denied by a PreToolUse hook, which applies before any permissions.allow rule from user or repo
// settings and also covers subagent tool calls.
export const READ_ONLY_TOOLS = Object.freeze([
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'ToolSearch', 'Task', 'Agent', 'WebSearch',
]);

export function readOnlyDecision(toolName: string): { allow: true } | { allow: false; reason: string } {
  return READ_ONLY_TOOLS.includes(toolName) ? { allow: true } : { allow: false, reason: READ_ONLY_DENY };
}

// Returning no decision for allowed tools leaves the normal permission flow in charge.
const readOnlyHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {};
  const verdict = readOnlyDecision(input.tool_name);
  if (verdict.allow) return {};
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
  };
};

const NOT_FOUND =
  'Claude Code was not found. Install it (https://claude.com/claude-code), run `claude` once in a terminal to log in, then click Retry.';

const untrustedMessage = (cwd: string) =>
  `This folder hasn't been trusted in Claude Code yet. Open a terminal in ${cwd}, run \`claude\`, accept the trust prompt, then click Retry.`;

interface Deps {
  query: QueryFn;
  emit: (e: SidecarEvent) => void;
  findClaude: (explicit?: string) => string | null;
  isTrusted: (cwd: string) => boolean;
  log: (s: string) => void;
}
interface Live {
  q: QueryLike;
  inbox: Inbox;
  translator: Translator;
}

export class SessionController {
  private cfg: { cwd: string; claudePath: string } | null = null;
  private current: Live | null = null;

  constructor(private deps: Deps) {}

  async handle(cmd: HostCommand): Promise<void> {
    switch (cmd.t) {
      case 'hello':
        return this.hello(cmd);
      case 'send':
        if (!this.current) {
          this.deps.emit({ t: 'error', code: 'fatal', message: 'No active session.' });
          return;
        }
        this.current.inbox.push(cmd.text);
        return;
      case 'interrupt':
        if (!this.current) return;
        this.current.translator.markInterrupt();
        await this.current.q.interrupt();
        return;
      case 'new_session':
        this.stop();
        if (this.cfg) this.start(undefined);
        return;
      case 'shutdown':
        this.stop();
        return;
    }
  }

  private hello(cmd: Extract<HostCommand, { t: 'hello' }>): void {
    if (cmd.protocol !== PROTOCOL_VERSION) {
      this.deps.emit({ t: 'error', code: 'protocol_mismatch', message: `Host protocol ${cmd.protocol}, sidecar protocol ${PROTOCOL_VERSION}.` });
      return;
    }
    const claudePath = this.deps.findClaude(cmd.claudePath);
    if (!claudePath) {
      this.deps.emit({ t: 'error', code: 'claude_not_found', message: NOT_FOUND });
      return;
    }
    if (!this.deps.isTrusted(cmd.cwd)) {
      this.deps.emit({ t: 'error', code: 'untrusted_folder', message: untrustedMessage(cmd.cwd) });
      return;
    }
    this.stop();
    this.cfg ={ cwd: cmd.cwd, claudePath };
    this.deps.emit({ t: 'ready', protocol: PROTOCOL_VERSION });
    this.start(cmd.resume);
  }

  private start(resume: string | undefined): void {
    const { cwd, claudePath } = this.cfg!;
    const inbox = new Inbox();
    const q = this.deps.query({
      prompt: inbox,
      options: {
        cwd,
        pathToClaudeCodeExecutable: claudePath,
        includePartialMessages: true,
        permissionMode: 'default',
        disallowedTools: [...BLOCKED_TOOLS],
        hooks: { PreToolUse: [{ hooks: [readOnlyHook] }] },
        resume,
        canUseTool: async () => ({ behavior: 'deny', message: READ_ONLY_DENY }),
        stderr: (d) => this.deps.log(d),
      },
    });
    const live: Live = { q, inbox, translator: new Translator() };
    this.current = live;
    void this.pump(live);
  }

  private async pump(live: Live): Promise<void> {
    try {
      for await (const msg of live.q) {
        if (this.current !== live) return;
        for (const ev of live.translator.translate(msg)) this.deps.emit(ev);
      }
    } catch (err: any) {
      if (this.current !== live) return;
      const message = String(err?.message ?? err);
      this.deps.log(`session failed: ${message}\n`);
      this.deps.emit({ t: 'error', code: isLoginError(message) ? 'not_logged_in' : 'fatal', message });
      this.current = null;
    }
  }

  private stop(): void {
    if (!this.current) return;
    const live = this.current;
    this.current = null;
    live.inbox.close();
    live.q.close();
  }
}
