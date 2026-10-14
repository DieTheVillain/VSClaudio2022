import { useState } from 'react';

interface Props {
  running: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ running, disabled, onSend, onStop }: Props) {
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
        placeholder="Ask Claude about your code…"
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
        <span className="hint">Enter to send · Shift+Enter for a new line</span>
        {running ? (
          <button className="round-btn stop" onClick={onStop} aria-label="Stop" title="Stop (Esc)">■</button>
        ) : (
          <button className="round-btn send" onClick={submit} disabled={disabled || !text.trim()} aria-label="Send" title="Send">↑</button>
        )}
      </div>
    </div>
  );
}
