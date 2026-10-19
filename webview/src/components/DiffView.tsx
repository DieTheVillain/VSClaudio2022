import type { DiffLine } from '../lineDiff';

const MARKS = { ' ': ' ', '+': '+', '-': '−' } as const;
const CLASSES = { ' ': 'diff-ctx', '+': 'diff-add', '-': 'diff-del' } as const;

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="diff" role="group" aria-label="Changes">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line ${CLASSES[l.op]}`}>
          <span className="diff-mark" aria-hidden="true">{MARKS[l.op]}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export function statsLabel(s: { added: number; removed: number }): string {
  return `+${s.added} −${s.removed}`;
}
