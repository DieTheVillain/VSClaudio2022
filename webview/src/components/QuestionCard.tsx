import { useState } from 'react';
import type { Question } from '../../../protocol/src/index';
import { OutcomeLine, type CardProps } from './cardParts';

// Other text, when present, replaces the picked options for that question.
export function buildAnswers(questions: Question[], picks: Record<number, string[]>, other: Record<number, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((q, i) => {
    const typed = other[i]?.trim();
    answers[q.question] = typed ? typed : (picks[i] ?? []).join(', ');
  });
  return answers;
}

export function QuestionCard({ item, respond }: CardProps) {
  const { request, outcome } = item;
  const questions = request.questions ?? [];
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const done = outcome !== undefined;
  const answered = questions.every((_, i) => (picks[i]?.length ?? 0) > 0 || !!other[i]?.trim());

  const toggle = (qi: number, label: string, multi: boolean) =>
    setPicks((p) => {
      const cur = p[qi] ?? [];
      return { ...p, [qi]: multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    });

  return (
    <div className="perm-card">
      {questions.map((q, qi) => (
        <fieldset key={qi} className="perm-question" disabled={done}>
          <legend><span className="chip">{q.header}</span> {q.question}</legend>
          {q.options.map((o) => (
            <label key={o.label} className="perm-option">
              <input
                type={q.multiSelect ? 'checkbox' : 'radio'}
                name={`${item.id}-q${qi}`}
                checked={(picks[qi] ?? []).includes(o.label)}
                onChange={() => toggle(qi, o.label, q.multiSelect)}
              />
              <span>
                {o.label}
                {o.description && <span className="muted small perm-option-desc">{o.description}</span>}
              </span>
            </label>
          ))}
          <input
            type="text"
            className="perm-other"
            placeholder="Other"
            aria-label={`Other answer for ${q.header}`}
            value={other[qi] ?? ''}
            onChange={(e) => setOther((o) => ({ ...o, [qi]: e.target.value }))}
          />
        </fieldset>
      ))}
      <div className="perm-actions">
        <button className="card-btn card-btn-primary" disabled={done || !answered} onClick={() => respond({ id: item.id, decision: 'allow', answers: buildAnswers(questions, picks, other) })}>Submit</button>
      </div>
      <OutcomeLine outcome={outcome} />
    </div>
  );
}
