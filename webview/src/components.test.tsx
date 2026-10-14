import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { HostToWebview, WebviewCommand } from '../../protocol/src/index';
import { App } from './App';
import type { HostApi } from './host';
import { Composer } from './components/Composer';
import { Markdown } from './components/Markdown';
import { ToolCard } from './components/ToolCard';
import { toolSummary } from './toolSummary';

function fakeHost() {
  const posted: WebviewCommand[] = [];
  let listener: ((m: HostToWebview) => void) | null = null;
  const host: HostApi = {
    post: (c) => posted.push(c),
    subscribe: (fn) => { listener = fn; return () => { listener = null; }; },
  };
  const push = (m: HostToWebview) => act(() => listener!(m));
  return { host, posted, push };
}

describe('toolSummary', () => {
  test('file paths show the file name', () => expect(toolSummary('Read', { file_path: 'C:\\src\\App\\Program.cs' })).toBe('Program.cs'));
  test('patterns and commands show as-is', () => {
    expect(toolSummary('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(toolSummary('Bash', { command: 'git status' })).toBe('git status');
  });
  test('long values are shortened', () => expect(toolSummary('Grep', { pattern: 'x'.repeat(200) }).length).toBe(120));
  test('unknown input gives empty summary', () => expect(toolSummary('X', undefined)).toBe(''));
});

describe('Markdown', () => {
  test('markdown does not render raw html', () => {
    const { container } = render(<Markdown text={'**bold** <script>window.x = 1</script><img src="x" onerror="alert(1)">'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  test('code blocks get a copy button', () => {
    render(<Markdown text={'```csharp\nvar x = 1;\n```'} />);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });
});

describe('ToolCard', () => {
  test('collapsed shows name and summary; expanding shows input, output and truncation', async () => {
    render(<ToolCard item={{ kind: 'tool', id: 'k', toolUseId: 'tu', name: 'Read', input: { file_path: 'C:\\a\\b.cs' }, result: 'contents', truncated: true, status: 'ok' }} />);
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('b.cs')).toBeInTheDocument();
    expect(screen.queryByText('contents')).toBeNull();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('contents')).toBeInTheDocument();
    expect(screen.getByText('Output truncated')).toBeInTheDocument();
  });
});

describe('Composer', () => {
  test('Enter sends and clears; Shift+Enter does not send', async () => {
    const onSend = vi.fn();
    render(<Composer running={false} disabled={false} onSend={onSend} onStop={() => {}} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('line one\nline two');
    expect(box).toHaveValue('');
  });

  test('composer shows stop while running and does not send', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Composer running={true} disabled={false} onSend={onSend} onStop={onStop} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'again{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('again');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onStop).toHaveBeenCalledTimes(2);
  });
});

describe('App', () => {
  test('announces itself, then shows the empty state once connected', () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    expect(posted).toEqual([{ t: 'webview_ready' }]);
    push({ t: 'status', state: 'connected' });
    expect(screen.getByText(/Ask Claude about this solution/)).toBeInTheDocument();
  });

  test('sending posts to the host and renders streamed reply', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    push({ t: 'status', state: 'connected' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hi{Enter}');
    expect(posted).toContainEqual({ t: 'send', text: 'hi' });
    push({ t: 'block_start', key: 'm:0', kind: 'text' });
    push({ t: 'block_delta', key: 'm:0', text: 'Hello **there**' });
    push({ t: 'turn_end', status: 'success' });
    expect(screen.getByText('there').tagName).toBe('STRONG');
  });

  test('setup card retry posts reconnect', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    push({ t: 'error', code: 'claude_not_found', message: 'Claude Code was not found.' });
    expect(screen.getByText('Claude Code needed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(posted).toContainEqual({ t: 'reconnect' });
  });

  test('new conversation clears the transcript and posts new_session', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    push({ t: 'status', state: 'connected' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hi{Enter}');
    push({ t: 'turn_end', status: 'success' });
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(posted).toContainEqual({ t: 'new_session' });
    expect(screen.queryByText('hi')).toBeNull();
  });

  test('theme variables are applied to the document', () => {
    const { host, push } = fakeHost();
    render(<App host={host} />);
    push({ t: 'theme', vars: { '--vsc-bg': '#F5F5F5' } });
    expect(document.documentElement.style.getPropertyValue('--vsc-bg')).toBe('#F5F5F5');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
