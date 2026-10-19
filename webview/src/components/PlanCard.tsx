import { useState } from 'react';
import type { PermissionMode } from '../../../protocol/src/index';
import { Markdown } from './Markdown';
import { MODE_LABELS } from './ModeChip';
import { NoteBox, OutcomeLine, type CardProps } from './cardParts';

// Approving a plan leaves plan mode, so it is not offered as the next mode.
const NEXT_MODES: PermissionMode[] = ['default', 'acceptEdits', 'auto'];

export function PlanCard({ item, respond }: CardProps) {
  const { request, outcome } = item;
  const [next, setNext] = useState<PermissionMode>('default');
  const [revising, setRevising] = useState(false);
  const done = outcome !== undefined;
  return (
    <div className="perm-card">
      <div className="perm-head">
        <span className="perm-title">Plan</span>
      </div>
      {request.plan ? <Markdown text={request.plan} /> : <p className="muted">Claude has finished planning.</p>}
      <label className="perm-mode">
        <span className="muted small">After approval</span>
        <select value={next} disabled={done} onChange={(e) => setNext(e.target.value as PermissionMode)}>
          {NEXT_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
      </label>
      <div className="perm-actions">
        <button className="card-btn card-btn-primary" disabled={done} onClick={() => respond({ id: item.id, decision: 'allow', nextMode: next })}>Approve</button>
        <button className="card-btn" disabled={done} onClick={() => setRevising(true)}>Keep planning</button>
      </div>
      {revising && !done && (
        <NoteBox placeholder="Tell Claude what to change" onSend={(message) => respond({ id: item.id, decision: 'deny', message })} />
      )}
      <OutcomeLine outcome={outcome} />
    </div>
  );
}
