import { useMemo, useState } from 'react';
import { diffStats, lineDiff } from '../lineDiff';
import { statsLabel } from './DiffView';
import { NoteBox, OutcomeLine, type CardProps } from './cardParts';

export function EditCard({ item, respond, onOpenDiff }: CardProps & { onOpenDiff: (id: string) => void }) {
  const { request, outcome } = item;
  const [rejecting, setRejecting] = useState(false);
  const done = outcome !== undefined;
  const stats = useMemo(
    () => (request.tooLarge ? undefined : diffStats(lineDiff(request.original ?? '', request.proposed ?? ''))),
    [request.tooLarge, request.original, request.proposed],
  );
  return (
    <div className="perm-card">
      <div className="perm-head">
        <span className="perm-title">Edit</span>
        <span className="perm-path">{request.path}</span>
        <span className="perm-stats">{stats ? statsLabel(stats) : 'too large to preview'}</span>
      </div>
      {!request.tooLarge && (
        <button className="link-btn" disabled={done} onClick={() => onOpenDiff(item.id)}>Open diff</button>
      )}
      <div className="perm-actions">
        <button className="card-btn card-btn-primary" disabled={done} onClick={() => respond({ id: item.id, decision: 'allow' })}>Accept</button>
        <button className="card-btn" disabled={done} onClick={() => setRejecting(true)}>Reject</button>
      </div>
      {rejecting && !done && (
        <NoteBox placeholder="Tell Claude what to do instead" onSend={(message) => respond({ id: item.id, decision: 'deny', message })} />
      )}
      <OutcomeLine outcome={outcome} edit />
    </div>
  );
}
