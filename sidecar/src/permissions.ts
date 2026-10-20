import { randomUUID } from 'node:crypto';
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type {
  PermissionKind, PermissionMode, PermissionOutcome, PermissionResponse, Question, SidecarEvent,
} from '../../protocol/src/index';
import { previewEdit } from './editPreview';

export const DEFAULT_DENY = 'The user rejected this.';
export const STALE_FILE_DENY = 'The file changed after this edit was proposed. Read it again before editing.';
const CANCELLED = 'Cancelled.';

export interface BrokerDeps {
  emit: (e: SidecarEvent) => void;
  readFile: (path: string) => string | null;
  setMode: (mode: PermissionMode) => Promise<void>;
  newId?: () => string;
}

interface Pending {
  kind: PermissionKind;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  // Edit requests only: what the user was shown, used to detect a file that changed while waiting.
  edit?: { path: string; original: string; isNewFile: boolean; tooLarge: boolean };
  settle: (result: PermissionResult, outcome: PermissionOutcome) => void;
}

export const MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
};

const formatRules = (rules: { toolName: string; ruleContent?: string }[]) =>
  rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ');

// The label is the card's "don't ask again" button text, so it must say what the suggestion actually does.
export function suggestionLabel(u: PermissionUpdate): string {
  switch (u.type) {
    case 'addRules':
    case 'replaceRules':
      return formatRules(u.rules);
    case 'setMode':
      return `switch to ${MODE_LABELS[u.mode as PermissionMode] ?? u.mode}`;
    case 'addDirectories':
      return `access to ${u.directories.join(', ')}`;
    case 'removeRules':
      return `remove rule ${formatRules(u.rules)}`;
    default:
      return 'Always allow';
  }
}

export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly newId: () => string;

  constructor(private readonly deps: BrokerDeps) {
    this.newId = deps.newId ?? (() => randomUUID());
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const id = this.newId();
      const entry: Pending = {
        kind: 'tool',
        input,
        suggestions: options.suggestions ?? [],
        settle: (result, outcome) => {
          if (!this.pending.delete(id)) return;
          options.signal.removeEventListener('abort', onAbort);
          resolve(result);
          this.deps.emit({ t: 'permission_resolved', id, outcome });
        },
      };
      const onAbort = () => entry.settle({ behavior: 'deny', message: CANCELLED }, 'cancelled');

      const request: Extract<SidecarEvent, { t: 'permission_request' }> = {
        t: 'permission_request', id, kind: 'tool', toolName, toolUseId: options.toolUseID, input,
      };
      if (toolName === 'ExitPlanMode') {
        entry.kind = request.kind = 'plan';
        if (typeof input.plan === 'string') request.plan = input.plan;
      } else if (toolName === 'AskUserQuestion') {
        entry.kind = request.kind = 'question';
        request.questions = input.questions as Question[];
      } else {
        const preview = previewEdit(toolName, input, this.deps.readFile);
        if (preview) {
          entry.kind = request.kind = 'edit';
          entry.edit = { path: preview.path, original: preview.original, isNewFile: preview.isNewFile, tooLarge: preview.tooLarge };
          Object.assign(request, preview);
        }
      }
      if (entry.suggestions.length > 0) {
        request.suggestions = entry.suggestions.map((s, i) => ({ label: suggestionLabel(s), index: i }));
      }

      this.pending.set(id, entry);
      this.deps.emit(request);
      // Registered after the request is out so an already-aborted signal still yields request then cancelled.
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    });

  respond(r: PermissionResponse): void {
    const entry = this.pending.get(r.id);
    if (!entry) return;

    if (r.decision === 'deny') {
      entry.settle({ behavior: 'deny', message: r.message || DEFAULT_DENY }, 'denied');
      return;
    }

    if (entry.edit && this.isStale(entry.edit)) {
      entry.settle({ behavior: 'deny', message: STALE_FILE_DENY }, 'denied');
      return;
    }

    const result: Extract<PermissionResult, { behavior: 'allow' }> = {
      behavior: 'allow',
      updatedInput: entry.kind === 'question' ? { ...entry.input, answers: r.answers ?? {} } : entry.input,
    };
    if (r.decision === 'allow_always' && entry.suggestions.length > 0) {
      const chosen = r.suggestionIndex === undefined ? entry.suggestions : [entry.suggestions[r.suggestionIndex]];
      const valid = chosen.filter((s) => s !== undefined);
      if (valid.length > 0) result.updatedPermissions = valid;
    }
    entry.settle(result, 'allowed');

    if (entry.kind === 'plan') {
      this.deps.setMode(r.nextMode ?? 'default').catch((e) => {
        this.deps.emit({ t: 'notice', level: 'error', text: `Could not change mode: ${e instanceof Error ? e.message : String(e)}` });
      });
    }
  }

  cancelAll(): void {
    for (const entry of [...this.pending.values()]) {
      entry.settle({ behavior: 'deny', message: CANCELLED }, 'cancelled');
    }
  }

  private isStale(edit: NonNullable<Pending['edit']>): boolean {
    // Over the preview cutoff the original was not captured, so there is nothing to compare against.
    if (edit.tooLarge) return false;
    let now: string | null;
    try {
      now = this.deps.readFile(edit.path);
    } catch {
      // A file that can't be read now (EBUSY, EACCES on Windows) can't be shown to match, so deny the edit.
      return true;
    }
    return edit.isNewFile ? now !== null : now !== edit.original;
  }
}
