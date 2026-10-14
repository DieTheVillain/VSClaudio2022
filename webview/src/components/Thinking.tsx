export function Thinking({ text }: { text: string }) {
  return (
    <details className="thinking">
      <summary>Thinking</summary>
      <div className="thinking-text">{text}</div>
    </details>
  );
}
