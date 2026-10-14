import { expect, test } from 'bun:test';
import { findClaude, type FindDeps } from '../src/findClaude';

const deps = (existing: string[], env: Record<string, string | undefined> = {}): FindDeps => ({
  env, home: 'C:\\Users\\me', exists: (p) => existing.includes(p),
});

test('explicit path wins when it exists', () => {
  expect(findClaude('D:\\tools\\claude.exe', deps(['D:\\tools\\claude.exe', 'C:\\Users\\me\\.local\\bin\\claude.exe']))).toBe('D:\\tools\\claude.exe');
});
test('missing explicit path falls back', () => {
  expect(findClaude('D:\\nope.exe', deps(['C:\\Users\\me\\.local\\bin\\claude.exe']))).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
});
test('VSCLAUDIO_CLAUDE_PATH beats the default install', () => {
  const d = deps(['E:\\c\\claude.exe', 'C:\\Users\\me\\.local\\bin\\claude.exe'], { VSCLAUDIO_CLAUDE_PATH: 'E:\\c\\claude.exe' });
  expect(findClaude(undefined, d)).toBe('E:\\c\\claude.exe');
});
test('searches PATH (any casing of the variable)', () => {
  expect(findClaude(undefined, deps(['F:\\bin\\claude.exe'], { Path: 'C:\\Windows;F:\\bin' }))).toBe('F:\\bin\\claude.exe');
});
test('returns null when nothing is found', () => {
  expect(findClaude(undefined, deps([], { PATH: 'C:\\Windows' }))).toBeNull();
});
