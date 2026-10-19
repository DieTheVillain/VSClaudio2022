import { describe, expect, test } from 'vitest';
import { diffStats, lineDiff } from './lineDiff';

describe('lineDiff', () => {
  test('identical text has no changes', () => {
    const d = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(d.every((l) => l.op === ' ')).toBe(true);
    expect(d.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  test('added and removed lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'x' },
      { op: ' ', text: 'c' },
      { op: '+', text: 'd' },
    ]);
  });

  test('CRLF and LF compare equal', () => {
    expect(diffStats(lineDiff('a\r\nb\r\n', 'a\nb\n'))).toEqual({ added: 0, removed: 0 });
  });

  test('diffStats counts', () => {
    expect(diffStats(lineDiff('a\nb', 'b\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });
});
