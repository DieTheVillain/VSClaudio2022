import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { HostToWebview, WebviewCommand } from '../../protocol/src/index';
import { App } from './App';
import type { HostApi } from './host';
import { Composer } from './components/Composer';
import { ModeChip } from './components/ModeChip';
import { Markdown } from './components/Markdown';
import { MessageList } from './components/MessageList';
import { Thinking, thinkingLabel } from './components/Thinking';
import { ToolCard } from './components/ToolCard';
import type { Item } from './state';
import { resultPreview, toolSummary } from './toolSummary';
import { EditCard } from './components/EditCard';
import { PermissionCard } from './components/PermissionCard';
import { PlanCard } from './components/PlanCard';
import { QuestionCard, buildAnswers } from './components/QuestionCard';
import type { PermissionItem } from './state';

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

  test('the header shows the Claude mark next to the title', () => {
    const { host } = fakeHost();
    const { container } = render(<App host={host} />);
    const header = container.querySelector('header')!;
    expect(within(header).getByRole('img', { name: 'Claude' })).toBeInTheDocument();
    expect(within(header).getByText('Claude')).toHaveClass('title');
  });

  test('the empty state shows a larger mark once connected', () => {
    const { host, push } = fakeHost();
    render(<App host={host} />);
    expect(screen.getAllByRole('img', { name: 'Claude' })).toHaveLength(1);
    push({ t: 'status', state: 'connected' });
    const marks = screen.getAllByRole('img', { name: 'Claude' });
    expect(marks).toHaveLength(2);
    expect(marks[1]).toHaveAttribute('width', '32');
    expect(marks[0]).toHaveAttribute('width', '14');
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

describe('ModeChip', () => {
  test('mode chip shows the current mode and posts set_mode on choice', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    await push({ t: 'status', state: 'connected' });
    await push({ t: 'mode', mode: 'plan' });
    const chip = screen.getByRole('button', { name: /Plan/ });
    await userEvent.click(chip);
    expect(screen.getAllByRole('menuitemradio').map((e) => e.textContent)).toEqual(['Ask before edits', 'Edit automatically', 'Plan', 'Auto']);
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Edit automatically' }));
    expect(posted).toContainEqual({ t: 'set_mode', mode: 'acceptEdits' });
    // The chip waits for the sidecar's confirmation.
    expect(screen.getByRole('button', { name: /Plan/ })).toBeInTheDocument();
    await push({ t: 'mode', mode: 'acceptEdits' });
    expect(screen.getByRole('button', { name: /Edit automatically/ })).toBeInTheDocument();
  });

  test('mode chip defaults to Ask before edits', () => {
    render(<ModeChip disabled={false} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Ask before edits/ })).toBeInTheDocument();
  });
});

type Req = PermissionItem['request'];
const perm = (request: Partial<Req> & Pick<Req, 'kind'>, outcome?: PermissionItem['outcome']): PermissionItem => ({
  kind: 'permission', id: 'p1', outcome,
  request: { t: 'permission_request', id: 'p1', toolName: 'Edit', input: {}, ...request } as Req,
});
const editItem = (outcome?: PermissionItem['outcome'], extra: Partial<Req> = {}) =>
  perm({ kind: 'edit', path: 'C:\\src\\a.cs', original: 'one\ntwo\n', proposed: 'one\nTWO\nthree\n', ...extra }, outcome);

describe('permission cards', () => {
  test('edit card shows path and +/- counts and posts allow on Accept', async () => {
    const respond = vi.fn();
    render(<EditCard item={editItem()} respond={respond} onOpenDiff={() => {}} />);
    expect(screen.getByText('C:\\src\\a.cs')).toBeInTheDocument();
    expect(screen.getByText('+2 \u22121')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'allow' });
  });

  test('edit card shows too large instead of counts and hides Open diff', () => {
    render(<EditCard item={editItem(undefined, { tooLarge: true })} respond={() => {}} onOpenDiff={() => {}} />);
    expect(screen.getByText('too large to preview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open diff' })).toBeNull();
  });

  test('edit card Reject with note posts deny with message', async () => {
    const respond = vi.fn();
    render(<EditCard item={editItem()} respond={respond} onOpenDiff={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await userEvent.type(screen.getByRole('textbox'), 'use a constant');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'deny', message: 'use a constant' });
  });

  test('edit card Open diff posts open_diff', async () => {
    const open = vi.fn();
    render(<EditCard item={editItem()} respond={() => {}} onOpenDiff={open} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open diff' }));
    expect(open).toHaveBeenCalledWith('p1');
  });

  test('permission card offers suggestion buttons and posts allow_always with index', async () => {
    const respond = vi.fn();
    const item = perm({ kind: 'tool', toolName: 'Bash', input: { command: 'dotnet test' }, suggestions: [{ label: 'dotnet test', index: 0 }, { label: 'Bash', index: 3 }] });
    render(<PermissionCard item={item} respond={respond} />);
    expect(screen.getByText('Allow Bash?')).toBeInTheDocument();
    expect(screen.getByText('dotnet test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Yes, don't ask again for Bash" }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'allow_always', suggestionIndex: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(respond).toHaveBeenLastCalledWith({ id: 'p1', decision: 'allow' });
  });

  test('permission card No sends a deny note', async () => {
    const respond = vi.fn();
    render(<PermissionCard item={perm({ kind: 'tool', toolName: 'Bash', input: { command: 'ls' } })} respond={respond} />);
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    await userEvent.type(screen.getByPlaceholderText('Tell Claude what to do instead'), 'skip it');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'deny', message: 'skip it' });
  });

  test('plan card approves with the chosen next mode', async () => {
    const respond = vi.fn();
    render(<PlanCard item={perm({ kind: 'plan', toolName: 'ExitPlanMode', plan: '1. Do it' })} respond={respond} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('default');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Ask before edits', 'Edit automatically', 'Auto']);
    await userEvent.selectOptions(select, 'acceptEdits');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'allow', nextMode: 'acceptEdits' });
  });

  test('plan card without text and Keep planning note', async () => {
    const respond = vi.fn();
    render(<PlanCard item={perm({ kind: 'plan', toolName: 'ExitPlanMode' })} respond={respond} />);
    expect(screen.getByText('Claude has finished planning.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep planning' }));
    await userEvent.type(screen.getByRole('textbox'), 'more detail');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'deny', message: 'more detail' });
  });

  const questions = [
    { question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'SQLite', description: 'Embedded' }, { label: 'Postgres' }] },
    { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Logging' }, { label: 'Metrics' }] },
  ];

  test('question card: multi-select joined, Other overrides', async () => {
    expect(buildAnswers(questions, { 0: ['SQLite'], 1: ['Logging', 'Metrics'] }, {})).toEqual({ 'Which database?': 'SQLite', 'Which extras?': 'Logging, Metrics' });
    expect(buildAnswers(questions, { 0: ['SQLite'], 1: ['Logging'] }, { 0: 'DuckDB', 1: '   ' })).toEqual({ 'Which database?': 'DuckDB', 'Which extras?': 'Logging' });

    const respond = vi.fn();
    render(<QuestionCard item={perm({ kind: 'question', toolName: 'AskUserQuestion', questions })} respond={respond} />);
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Embedded')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/SQLite/));
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Logging/));
    await userEvent.click(screen.getByLabelText(/Metrics/));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(respond).toHaveBeenCalledWith({ id: 'p1', decision: 'allow', answers: { 'Which database?': 'SQLite', 'Which extras?': 'Logging, Metrics' } });
  });

  test('resolved cards show their outcome and disable controls', () => {
    const r1 = render(<EditCard item={editItem('allowed')} respond={() => {}} onOpenDiff={() => {}} />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    r1.unmount();
    const r2 = render(<EditCard item={editItem('denied')} respond={() => {}} onOpenDiff={() => {}} />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    r2.unmount();
    const r3 = render(<PermissionCard item={perm({ kind: 'tool', toolName: 'Bash', input: {}, suggestions: [{ label: 'x', index: 0 }] }, 'allowed')} respond={() => {}} />);
    expect(screen.getByText('Allowed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: "Yes, don't ask again for x" })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
    r3.unmount();
    const r4 = render(<PermissionCard item={perm({ kind: 'tool', toolName: 'Bash', input: {} }, 'denied')} respond={() => {}} />);
    expect(screen.getByText('Denied')).toBeInTheDocument();
    r4.unmount();
    const r5 = render(<PlanCard item={perm({ kind: 'plan', toolName: 'ExitPlanMode', plan: 'p' }, 'cancelled')} respond={() => {}} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    r5.unmount();
    render(<QuestionCard item={perm({ kind: 'question', toolName: 'AskUserQuestion', questions }, 'allowed')} respond={() => {}} />);
    expect(screen.getByText('Allowed')).toBeInTheDocument();
    expect(screen.getByLabelText(/SQLite/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  test('mode change keeps pending requests pending', async () => {
    const { host, push } = fakeHost();
    render(<App host={host} />);
    await push({ t: 'status', state: 'connected' });
    await push({ t: 'permission_request', id: 'e1', kind: 'edit', toolName: 'Edit', input: {}, path: 'a.cs', original: 'a', proposed: 'b' });
    await push({ t: 'mode', mode: 'acceptEdits' });
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.queryByText('Accepted')).toBeNull();
  });

  test('App posts permission_response and open_diff', async () => {
    const { host, posted, push } = fakeHost();
    render(<App host={host} />);
    await push({ t: 'status', state: 'connected' });
    await push({ t: 'permission_request', id: 'e1', kind: 'edit', toolName: 'Edit', input: {}, path: 'a.cs', original: 'a', proposed: 'b' });
    await userEvent.click(screen.getByRole('button', { name: 'Open diff' }));
    expect(posted).toContainEqual({ t: 'open_diff', id: 'e1' });
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(posted).toContainEqual({ t: 'permission_response', id: 'e1', decision: 'allow' });
  });

  test('auto-applied Edit row expands to an inline diff', async () => {
    const item: Item = { kind: 'tool', id: 't', toolUseId: 'tu', name: 'Edit', status: 'ok', input: { file_path: 'a.cs', old_string: 'one\ntwo', new_string: 'one\nTWO\nthree' }, result: 'ok' };
    render(<ToolCard item={item} />);
    expect(screen.getByText('+2 \u22121')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('TWO')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('IN')).toBeNull();
  });

  test('auto-applied Write row diffs against empty', () => {
    const item: Item = { kind: 'tool', id: 't', toolUseId: 'tu', name: 'Write', status: 'ok', input: { file_path: 'n.cs', content: 'a\nb' } };
    render(<ToolCard item={item} />);
    expect(screen.getByText('+2 \u22120')).toBeInTheDocument();
  });
});
