import { useState } from 'react';
import type { PermissionMode } from '../../../protocol/src/index';
import { ModeChip } from './ModeChip';

interface Props {
  running: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  mode?: PermissionMode;
  onModeChange?: (m: PermissionMode) => void;
}

export function Composer({ running, disabled, onSend, onStop, mode, onModeChange }: Props) {
  const [text, setText] = useState('');
  const submit = () => {
    if (running || disabled || !text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <div className="composer">
      <textarea
        aria-label="Message"
        value={text}
        rows={3}
        disabled={disabled}
        placeholder="Ask Claude…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape' && running) {
            e.preventDefault();
            onStop();
          }
        }}
      />
      <div className="composer-bar">
        <ModeChip mode={mode} disabled={disabled} onChange={(m) => onModeChange?.(m)} />
        {running ? (
          <button className="square-btn stop" onClick={onStop} aria-label="Stop" title="Stop (Esc)">■</button>
        ) : (
          <button className="square-btn send" onClick={submit} disabled={disabled || !text.trim()} aria-label="Send" title="Send">↑</button>
        )}
      </div>
    </div>
  );
}
