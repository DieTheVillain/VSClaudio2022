import { useState } from 'react';
import type { Item } from '../state';
import { resultPreview, toolSummary } from '../toolSummary';

type ToolItem = Extract<Item, { kind: 'tool' }>;

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(item.name, item.input);
  const preview = resultPreview(item.name, item.result);
  return (
    <div className={`tool tool-${item.status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tool-title">
          <span className="tool-name">{item.name}</span>
          {summary && <span className="tool-summary">{summary}</span>}
        </span>
        {preview && <span className={item.status === 'error' ? 'tool-preview tool-preview-error' : 'tool-preview'}>{preview}</span>}
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-section">
            <div className="label">IN</div>
            <pre>{item.input === undefined ? '' : JSON.stringify(item.input, null, 2)}</pre>
          </div>
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
