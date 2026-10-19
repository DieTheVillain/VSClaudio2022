import { useState } from 'react';
import type { PermissionResponse } from '../../../protocol/src/index';
import type { PermissionItem } from '../state';

export type Respond = (r: Omit<PermissionResponse, 't'>) => void;
export type CardProps = { item: PermissionItem; respond: Respond };

const OUTCOME_LABELS = { allowed: 'Allowed', denied: 'Denied', cancelled: 'Cancelled' } as const;
const EDIT_OUTCOME_LABELS = { allowed: 'Accepted', denied: 'Rejected', cancelled: 'Cancelled' } as const;

// Shown once the request is settled; cards disable their controls at the same time.
export function OutcomeLine({ outcome, edit }: { outcome: PermissionItem['outcome']; edit?: boolean }) {
  if (!outcome) return null;
  return <div className="card-status muted small">{(edit ? EDIT_OUTCOME_LABELS : OUTCOME_LABELS)[outcome]}</div>;
}

// Free-text reason sent with a deny, so Claude can adjust instead of retrying blindly.
export function NoteBox({ placeholder, onSend }: { placeholder: string; onSend: (message: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="card-note">
      <input type="text" value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
      <button className="card-btn card-btn-primary" onClick={() => onSend(text)}>Send</button>
    </div>
  );
}
