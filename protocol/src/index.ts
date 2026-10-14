export const PROTOCOL_VERSION = 1;

export type BlockKind = 'text' | 'thinking' | 'tool_use';
export type ErrorCode = 'claude_not_found' | 'not_logged_in' | 'protocol_mismatch' | 'fatal';
export type ConnectionState = 'starting' | 'connected' | 'disconnected' | 'no_workspace';

/** Host (VS extension) -> sidecar, one JSON object per stdin line. */
export type HostCommand =
  | { t: 'hello'; protocol: number; cwd: string; claudePath?: string; resume?: string }
  | { t: 'send'; text: string }
  | { t: 'interrupt' }
  | { t: 'new_session' }
  | { t: 'shutdown' };

/** Sidecar -> host, one JSON object per stdout line. The host forwards these to the webview unchanged. */
export type SidecarEvent =
  | { t: 'ready'; protocol: number }
  | { t: 'session'; sessionId: string; model: string; cwd: string }
  | { t: 'block_start'; key: string; kind: BlockKind; toolUseId?: string; name?: string }
  | { t: 'block_delta'; key: string; text: string }
  | { t: 'tool_input'; toolUseId: string; name: string; input: unknown }
  | { t: 'tool_result'; toolUseId: string; content: string; isError: boolean; truncated: boolean }
  | { t: 'turn_end'; status: 'success' | 'interrupted' | 'error'; error?: string; durationMs?: number; costUsd?: number }
  | { t: 'error'; code: ErrorCode; message: string };

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
  | { t: 'choose_folder' };
