import { useMemo, useState } from 'react';
import { diffStats, lineDiff, type DiffLine } from '../lineDiff';
import type { Item } from '../state';
import { resultPreview, toolSummary } from '../toolSummary';
import { DiffView, statsLabel } from './DiffView';

type ToolItem = Extract<Item, { kind: 'tool' }>;

// Edit and Write rows that applied without a prompt show what changed instead of the raw input.
function changeDiff(name: string, input: unknown): DiffLine[] | undefined {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === 'Edit' && typeof i.old_string === 'string' && typeof i.new_string === 'string') return lineDiff(i.old_string, i.new_string);
  if (name === 'Write' && typeof i.content === 'string') return lineDiff('', i.content);
  return undefined;
}

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(item.name, item.input);
  const diff = useMemo(() => changeDiff(item.name, item.input), [item.name, item.input]);
  const preview = resultPreview(item.name, item.result);
  return (
    <div className={`tool tool-${item.status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tool-title">
          <span className="tool-name">{item.name}</span>
          {summary && <span className="tool-summary">{summary}</span>}
          {diff && <span className="tool-stats">{statsLabel(diffStats(diff))}</span>}
        </span>
        {preview && <span className={item.status === 'error' ? 'tool-preview tool-preview-error' : 'tool-preview'}>{preview}</span>}
      </button>
      {open && (
        <div className="tool-body">
          {diff ? (
            <DiffView lines={diff} />
          ) : (
            <div className="tool-section">
              <div className="label">IN</div>
              <pre>{item.input === undefined ? '' : JSON.stringify(item.input, null, 2)}</pre>
            </div>
          )}
          {item.result !== undefined && (
            <div className="tool-section">
              <div className="label">OUT</div>
              <pre>{item.result}</pre>
              {item.truncated && <div className="muted small">Output truncated</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
