export type DiffLine = { op: ' ' | '+' | '-'; text: string };

function toLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline terminates the last line; it does not start an empty one.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Above this many LCS cells (middle lines before x after) the diff degrades to remove-all/add-all.
export const MAX_DIFF_CELLS = 4_000_000;

// Line-based diff. Common leading and trailing lines are trimmed first so the LCS table only covers the
// differing middle. CRLF and LF compare equal.
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = toLines(before);
  const b = toLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const out: DiffLine[] = [];
  for (let k = 0; k < head; k++) out.push({ op: ' ', text: a[k] });
  out.push(...diffMiddle(a.slice(head, a.length - tail), b.slice(head, b.length - tail)));
  for (let k = a.length - tail; k < a.length; k++) out.push({ op: ' ', text: a[k] });
  return out;
}

function diffMiddle(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const out: DiffLine[] = [];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    for (const text of a) out.push({ op: '-', text });
    for (const text of b) out.push({ op: '+', text });
    return out;
  }
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      out.push({ op: '-', text: a[i++] });
    } else {
      out.push({ op: '+', text: b[j++] });
    }
  }
  while (i < n) out.push({ op: '-', text: a[i++] });
  while (j < m) out.push({ op: '+', text: b[j++] });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === '+') added++;
    else if (l.op === '-') removed++;
  }
  return { added, removed };
}
