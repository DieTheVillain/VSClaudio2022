import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PROTOCOL_VERSION, type HostCommand, type PermissionMode, type SidecarEvent } from '../../protocol/src/index';
import { EditGate } from './editGate';
import { Inbox } from './inbox';
import { PermissionBroker } from './permissions';
import { isLoginError, Translator } from './translate';

export interface QueryLike extends AsyncIterable<any> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): void;
}
export type QueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryLike;

const MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
};

const NOT_FOUND =
  'Claude Code was not found. Install it (https://claude.com/claude-code), run `claude` once in a terminal to log in, then click Retry.';

const SESSION_ENDED_EXIT_CODE = 3;

const untrustedMessage = (cwd: string) =>
  `This folder hasn't been trusted in Claude Code yet. Open a terminal in ${cwd}, run \`claude\`, accept the trust prompt, then click Retry.`;

interface Deps {
  query: QueryFn;
  emit: (e: SidecarEvent) => void;
  findClaude: (explicit?: string) => string | null;
  isTrusted: (cwd: string) => boolean;
  log: (s: string) => void;
  readFile: (path: string) => string | null;
  exit: (code: number) => void;
}
interface Live {
  q: QueryLike;
  inbox: Inbox;
  translator: Translator;
  broker: PermissionBroker;
  gate: EditGate;
}

export class SessionController {
  private cfg: { cwd: string; claudePath: string } | null = null;
  private current: Live | null = null;
  private mode: PermissionMode = 'default';

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
      case 'permission_response':
        this.current?.broker.respond(cmd);
        return;
      case 'edit_prepared':
        this.current?.gate.ack(cmd.id);
        return;
      case 'set_mode':
        return this.setMode(cmd.mode);
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
    const broker = new PermissionBroker({
      emit: this.deps.emit,
      readFile: this.deps.readFile,
      setMode: (m) => this.setMode(m),
    });
    const gate = new EditGate({ emit: this.deps.emit, log: this.deps.log });
    this.mode = 'default';
    const q = this.deps.query({
      prompt: inbox,
      options: {
        cwd,
        pathToClaudeCodeExecutable: claudePath,
        includePartialMessages: true,
        permissionMode: 'default',
        hooks: { PreToolUse: [{ hooks: [gate.hook] }] },
        resume,
        canUseTool: broker.canUseTool,
        stderr: (d) => this.deps.log(d),
      },
    });
    const live: Live = { q, inbox, translator: new Translator(), broker, gate };
    this.current = live;
    void this.pump(live);
  }

  // When the active query ends for any reason other than a login problem, the sidecar exits
  // non-zero: the host then ends the turn, shows "disconnected", and Reconnect resumes the session.
  private async pump(live: Live): Promise<void> {
    try {
      for await (const msg of live.q) {
        if (this.current !== live) return;
        for (const ev of live.translator.translate(msg)) {
          if (ev.t === 'mode') this.mode = ev.mode;
          this.deps.emit(ev);
        }
      }
    } catch (err: any) {
      if (this.current !== live) return;
      const message = String(err?.message ?? err);
      this.deps.log(`session failed: ${message}\n`);
      this.current = null;
      if (isLoginError(message)) {
        this.deps.emit({ t: 'error', code: 'not_logged_in', message });
        return;
      }
      this.deps.emit({ t: 'error', code: 'fatal', message });
      this.deps.exit(SESSION_ENDED_EXIT_CODE);
      return;
    }
    if (this.current !== live) return;
    this.deps.log('session ended unexpectedly\n');
    this.current = null;
    this.deps.exit(SESSION_ENDED_EXIT_CODE);
  }

  // Applies a mode change to the live query. The broker also calls this when a plan is approved.
  private async setMode(mode: PermissionMode): Promise<void> {
    if (!this.current) return;
    try {
      await this.current.q.setPermissionMode(mode);
      this.mode = mode;
    } catch (err: any) {
      this.deps.emit({ t: 'notice', level: 'error', text: `${MODE_LABELS[mode]} mode isn't available: ${String(err?.message ?? err)}` });
    }
    this.deps.emit({ t: 'mode', mode: this.mode });
  }

  private stop(): void {
    if (!this.current) return;
    const live = this.current;
    this.current = null;
    live.broker.cancelAll();
    live.inbox.close();
    live.q.close();
  }
}
