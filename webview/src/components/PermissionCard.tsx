import { useState } from 'react';
import { toolSummary } from '../toolSummary';
import { NoteBox, OutcomeLine, type CardProps } from './cardParts';

export function PermissionCard({ item, respond }: CardProps) {
  const { request, outcome } = item;
  const [denying, setDenying] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const done = outcome !== undefined;
  const detail = toolSummary(request.toolName, request.input);
  return (
    <div className="perm-card">
      <div className="perm-head">
        <span className="perm-title">Allow {request.toolName}?</span>
      </div>
      {detail && <div className="perm-detail">{detail}</div>}
      <button className="link-btn" aria-expanded={showInput} onClick={() => setShowInput((o) => !o)}>Full input</button>
      {showInput && <pre className="perm-input">{JSON.stringify(request.input, null, 2)}</pre>}
      <div className="perm-actions perm-actions-col">
        <button className="card-btn card-btn-primary" disabled={done} onClick={() => respond({ id: item.id, decision: 'allow' })}>Yes</button>
        {request.suggestions?.map((s) => (
          <button key={s.index} className="card-btn" disabled={done} onClick={() => respond({ id: item.id, decision: 'allow_always', suggestionIndex: s.index })}>
            Yes, don't ask again for {s.label}
          </button>
        ))}
        <button className="card-btn" disabled={done} onClick={() => setDenying(true)}>No</button>
      </div>
      {denying && !done && (
        <NoteBox placeholder="Tell Claude what to do instead" onSend={(message) => respond({ id: item.id, decision: 'deny', message })} />
      )}
      <OutcomeLine outcome={outcome} />
    </div>
  );
}
