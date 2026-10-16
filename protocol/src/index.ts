export const PROTOCOL_VERSION = 2;

export type BlockKind = 'text' | 'thinking' | 'tool_use';
export type ErrorCode = 'claude_not_found' | 'not_logged_in' | 'protocol_mismatch' | 'untrusted_folder' | 'fatal';
export type ConnectionState = 'starting' | 'connected' | 'disconnected' | 'no_workspace';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';
export type PermissionKind = 'edit' | 'tool' | 'plan' | 'question';
export type PermissionDecision = 'allow' | 'allow_always' | 'deny';
export type PermissionOutcome = 'allowed' | 'denied' | 'cancelled';

export interface QuestionOption { label: string; description?: string }
export interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }

/** The user's answer to a permission_request; sent webview -> host -> sidecar (or from the diff tab). */
export interface PermissionResponse {
  t: 'permission_response';
  id: string;
  decision: PermissionDecision;
  suggestionIndex?: number;
  message?: string;
  answers?: Record<string, string>;
  nextMode?: PermissionMode;
}

/** Host (VS extension) -> sidecar, one JSON object per stdin line. */
export type HostCommand =
  | { t: 'hello'; protocol: number; cwd: string; claudePath?: string; resume?: string }
  | { t: 'send'; text: string }
  | { t: 'interrupt' }
  | { t: 'new_session' }
  | { t: 'shutdown' }
  | PermissionResponse
  | { t: 'set_mode'; mode: PermissionMode }
  | { t: 'edit_prepared'; id: string };

/** Sidecar -> host, one JSON object per stdout line. The host forwards these to the webview unchanged. */
export type SidecarEvent =
  | { t: 'ready'; protocol: number }
  | { t: 'session'; sessionId: string; model: string; cwd: string }
  | { t: 'block_start'; key: string; kind: BlockKind; toolUseId?: string; name?: string }
  | { t: 'block_delta'; key: string; text: string }
  | { t: 'tool_input'; toolUseId: string; name: string; input: unknown }
  | { t: 'tool_result'; toolUseId: string; content: string; isError: boolean; truncated: boolean }
  | { t: 'turn_end'; status: 'success' | 'interrupted' | 'error'; error?: string; durationMs?: number; costUsd?: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | {
      t: 'permission_request'; id: string; kind: PermissionKind; toolName: string; toolUseId?: string; input: unknown;
      path?: string; original?: string; proposed?: string; isNewFile?: boolean; tooLarge?: boolean;
      suggestions?: { label: string; index: number }[]; plan?: string; questions?: Question[];
    }
  | { t: 'permission_resolved'; id: string; outcome: PermissionOutcome }
  | { t: 'mode'; mode: PermissionMode }
  | { t: 'notice'; level: 'info' | 'error'; text: string }
  | { t: 'prepare_edit'; id: string; path: string };

/** Host -> webview: forwarded sidecar events plus host-only messages. */
export type HostToWebview =
  | SidecarEvent
  | { t: 'status'; state: ConnectionState; detail?: string }
  | { t: 'theme'; vars: Record<string, string> };

/** Webview -> host. */
export type WebviewCommand =
  | { t: 'webview_ready' }
  | { t: 'send'; text: string }
  | { t: 'interrupt' }
  | { t: 'new_session' }
  | { t: 'reconnect' }
  | { t: 'choose_folder' }
  | PermissionResponse
  | { t: 'set_mode'; mode: PermissionMode }
  | { t: 'open_diff'; id: string };
