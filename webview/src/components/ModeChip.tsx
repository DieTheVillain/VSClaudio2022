import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '../../../protocol/src/index';

export const MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
};

const MODES = Object.keys(MODE_LABELS) as PermissionMode[];

interface Props {
  mode?: PermissionMode;
  disabled: boolean;
  onChange: (m: PermissionMode) => void;
}

export function ModeChip({ mode = 'default', disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="mode-chip" ref={root} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button className="mode-chip-btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} title="Permission mode" onClick={() => setOpen((o) => !o)}>
        {MODE_LABELS[mode]}
      </button>
      {open && (
        <div className="mode-menu" role="menu" aria-label="Permission mode">
          {MODES.map((m) => (
            <button key={m} role="menuitemradio" aria-checked={m === mode} className="mode-item" onClick={() => { setOpen(false); onChange(m); }}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
