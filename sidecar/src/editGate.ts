import { randomUUID } from 'node:crypto';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { SidecarEvent } from '../../protocol/src/index';

export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
export const PREPARE_TIMEOUT_MS = 5000;

export interface EditGateDeps {
  emit: (e: SidecarEvent) => void;
  log: (s: string) => void;
  timeoutMs?: number;
  newId?: () => string;
}

// Before an edit tool runs, asks the host to save any dirty editor buffer for the target file so
// Claude edits what the user sees. It never makes a permission decision; on timeout it proceeds.
export class EditGate {
  private readonly waiting = new Map<string, () => void>();
  private readonly timeoutMs: number;
  private readonly newId: () => string;

  constructor(private readonly deps: EditGateDeps) {
    this.timeoutMs = deps.timeoutMs ?? PREPARE_TIMEOUT_MS;
    this.newId = deps.newId ?? (() => randomUUID());
  }

  readonly hook: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || !EDIT_TOOLS.includes(input.tool_name)) return {};
    const args = (input.tool_input ?? {}) as Record<string, unknown>;
    const path = args.file_path ?? args.notebook_path;
    if (typeof path !== 'string') return {};
    const id = this.newId();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        this.deps.log(`prepare_edit ${id} timed out after ${this.timeoutMs} ms; continuing\n`);
        resolve();
      }, this.timeoutMs);
      this.waiting.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      this.deps.emit({ t: 'prepare_edit', id, path });
    });
    return {};
  };

  ack(id: string): void {
    const release = this.waiting.get(id);
    if (!release) return;
    this.waiting.delete(id);
    release();
  }
}
