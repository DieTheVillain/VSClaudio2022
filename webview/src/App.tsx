import { useEffect, useReducer } from 'react';
import { Composer } from './components/Composer';
import { Disconnected, NoWorkspace, SetupCard } from './components/Banners';
import { MessageList } from './components/MessageList';
import type { HostApi } from './host';
import { initialState, reducer } from './state';

function isDark(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

export function App({ host }: { host: HostApi }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const off = host.subscribe((msg) => dispatch({ type: 'host', msg, at: Date.now() }));
    host.post({ t: 'webview_ready' });
    return off;
  }, [host]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(state.theme)) root.style.setProperty(k, v);
    root.dataset.theme = isDark(state.theme['--vsc-bg']) ? 'dark' : 'light';
  }, [state.theme]);

  const ready = state.connection === 'connected' && !state.setup;
  const send = (text: string) => {
    if (state.running) return;
    dispatch({ type: 'user_send', text, at: Date.now() });
    host.post({ t: 'send', text });
  };
  const newConversation = () => {
    dispatch({ type: 'clear' });
    host.post({ t: 'new_session' });
  };

  return (
    <div className="app">
      <header className="header">
        <span className="title">{state.model ?? 'Claude'}</span>
        <button className="icon-btn" onClick={newConversation} aria-label="New conversation" title="New conversation">+</button>
      </header>
      <MessageList items={state.items} running={state.running} />
      {ready && state.items.length === 0 && (
        <div className="empty">Ask Claude about this solution. It can read and search your code; editing comes in a later version.</div>
      )}
      {state.setup && <SetupCard code={state.setup.code} message={state.setup.message} onRetry={() => host.post({ t: 'reconnect' })} />}
      {!state.setup && state.connection === 'disconnected' && (
        <Disconnected detail={state.connectionDetail} onReconnect={() => host.post({ t: 'reconnect' })} />
      )}
      {state.connection === 'no_workspace' && <NoWorkspace onChoose={() => host.post({ t: 'choose_folder' })} />}
      {state.connection === 'starting' && !state.setup && <div className="muted status-line">Starting Claude…</div>}
      <Composer running={state.running} disabled={!ready} onSend={send} onStop={() => host.post({ t: 'interrupt' })} />
    </div>
  );
}
