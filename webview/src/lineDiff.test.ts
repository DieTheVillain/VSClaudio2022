import { describe, expect, test } from 'vitest';
import { MAX_DIFF_CELLS, diffStats, lineDiff } from './lineDiff';

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

  test('trims common prefix and suffix', () => {
    const base = Array.from({ length: 2000 }, (_, k) => `line ${k}`);
    const changed = base.slice();
    changed.splice(1000, 3, 'x', 'y', 'z');
    const t = Date.now();
    const d = lineDiff(base.join('\n'), changed.join('\n'));
    expect(Date.now() - t).toBeLessThan(500);
    expect(diffStats(d)).toEqual({ added: 3, removed: 3 });
    expect(d.filter((l) => l.op !== ' ').map((l) => l.op + l.text)).toEqual(['-line 1000', '-line 1001', '-line 1002', '+x', '+y', '+z']);
    expect(d.length).toBe(2003);
  });

  test('falls back to a coarse diff above MAX_DIFF_CELLS', () => {
    const n = 2100;
    expect(n * n).toBeGreaterThan(MAX_DIFF_CELLS);
    const a = Array.from({ length: n }, (_, k) => `a${k}`);
    const b = Array.from({ length: n }, (_, k) => `b${k}`);
    const d = lineDiff(a.join('\n'), b.join('\n'));
    expect(d.slice(0, n).every((l) => l.op === '-')).toBe(true);
    expect(d.slice(n).every((l) => l.op === '+')).toBe(true);
    expect(diffStats(d)).toEqual({ added: n, removed: n });
  });

  test('empty inputs', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('', 'a')).toEqual([{ op: '+', text: 'a' }]);
    expect(lineDiff('a', '')).toEqual([{ op: '-', text: 'a' }]);
  });

  test('trailing newline alone is not a change', () => {
    expect(diffStats(lineDiff('a\n', 'a'))).toEqual({ added: 0, removed: 0 });
  });
});
