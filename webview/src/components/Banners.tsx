const TITLES: Record<string, string> = {
  claude_not_found: 'Claude Code needed',
  not_logged_in: 'Log in to Claude Code',
  protocol_mismatch: 'Extension needs a rebuild',
};

export function SetupCard({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  return (
    <div className="card" role="alert">
      <h2>{TITLES[code] ?? 'Setup needed'}</h2>
      <p>{message}</p>
      {code === 'not_logged_in' && <p>Open a terminal, run <code>claude</code>, and finish logging in.</p>}
      <button className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function Disconnected({ detail, onReconnect }: { detail?: string; onReconnect: () => void }) {
  return (
    <div className="card" role="status">
      <h2>Session disconnected</h2>
      {detail && <p className="muted">{detail}</p>}
      <button className="btn" onClick={onReconnect}>Reconnect</button>
    </div>
  );
}

export function NoWorkspace({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="card" role="status">
      <h2>No folder open</h2>
      <p>Open a solution, or choose a folder for Claude to work in.</p>
      <button className="btn" onClick={onChoose}>Choose folder…</button>
    </div>
  );
}
