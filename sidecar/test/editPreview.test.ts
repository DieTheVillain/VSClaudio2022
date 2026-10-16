import { expect, test } from 'bun:test';
import { MAX_PREVIEW_BYTES, previewEdit } from '../src/editPreview';

const fs = (files: Record<string, string>) => (p: string) => (p in files ? files[p] : null);

test('Edit replaces a unique match', () => {
  const r = previewEdit('Edit', { file_path: 'a.txt', old_string: 'two', new_string: '2' }, fs({ 'a.txt': 'one two three' }));
  expect(r).toEqual({ path: 'a.txt', original: 'one two three', proposed: 'one 2 three', isNewFile: false, tooLarge: false });
});

test('Edit with replace_all replaces every match', () => {
  const r = previewEdit('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true }, fs({ 'a.txt': 'x-x-x' }));
  expect(r?.proposed).toBe('y-y-y');
});

test('Edit returns null when old_string is missing or ambiguous', () => {
  const read = fs({ 'a.txt': 'x-x' });
  expect(previewEdit('Edit', { file_path: 'a.txt', old_string: 'q', new_string: 'y' }, read)).toBeNull();
  expect(previewEdit('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, read)).toBeNull();
  expect(previewEdit('Edit', { file_path: 'missing.txt', old_string: 'x', new_string: 'y' }, read)).toBeNull();
});

test('matches LF old_string against a CRLF file and keeps CRLF', () => {
  const r = previewEdit('Edit', { file_path: 'a.txt', old_string: 'a\nb', new_string: 'x\ny' }, fs({ 'a.txt': 'a\r\nb\r\nc\r\n' }));
  expect(r?.proposed).toBe('x\r\ny\r\nc\r\n');
});

test('replacement text is literal, not a replace pattern', () => {
  const r = previewEdit('Edit', { file_path: 'a.txt', old_string: 'a', new_string: '$&$1' }, fs({ 'a.txt': 'a' }));
  expect(r?.proposed).toBe('$&$1');
});

test('Write to an existing file', () => {
  const r = previewEdit('Write', { file_path: 'a.txt', content: 'new' }, fs({ 'a.txt': 'old' }));
  expect(r).toEqual({ path: 'a.txt', original: 'old', proposed: 'new', isNewFile: false, tooLarge: false });
});

test('Write to a new file sets isNewFile and empty original', () => {
  const r = previewEdit('Write', { file_path: 'n.txt', content: 'hi' }, fs({}));
  expect(r).toEqual({ path: 'n.txt', original: '', proposed: 'hi', isNewFile: true, tooLarge: false });
});

test('marks content over MAX_PREVIEW_BYTES as tooLarge with empty texts', () => {
  const big = 'a'.repeat(MAX_PREVIEW_BYTES + 1);
  const w = previewEdit('Write', { file_path: 'n.txt', content: big }, fs({}));
  expect(w).toEqual({ path: 'n.txt', original: '', proposed: '', isNewFile: true, tooLarge: true });
  const e = previewEdit('Edit', { file_path: 'b.txt', old_string: 'Z', new_string: 'b' }, fs({ 'b.txt': big + 'Z' }));
  expect(e).toEqual({ path: 'b.txt', original: '', proposed: '', isNewFile: false, tooLarge: true });
  const ok = previewEdit('Write', { file_path: 'n.txt', content: 'a'.repeat(MAX_PREVIEW_BYTES) }, fs({}));
  expect(ok?.tooLarge).toBe(false);
});

test('returns null for NotebookEdit and unknown tools', () => {
  expect(previewEdit('NotebookEdit', { notebook_path: 'n.ipynb' }, fs({}))).toBeNull();
  expect(previewEdit('Bash', { command: 'ls' }, fs({}))).toBeNull();
  expect(previewEdit('Edit', null, fs({}))).toBeNull();
  expect(previewEdit('Write', { file_path: 'a' }, fs({}))).toBeNull();
});
