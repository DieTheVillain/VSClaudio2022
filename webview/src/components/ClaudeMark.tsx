// Same starburst as vsix/Resources/MakeIcon.ps1: eight round-capped rays every 45 degrees from
// straight up, slightly uneven lengths, meeting in a solid centre. Drawn on a 100-unit grid.
const LENGTHS = [1.0, 0.8, 0.94, 0.76, 0.98, 0.84, 0.9, 0.78];
const CENTER = 50;
const STROKE = 13;
const REACH = CENTER - STROKE / 2 - 2;

const RAYS = LENGTHS.map((f, i) => {
  const angle = ((i * 45 - 90) * Math.PI) / 180;
  const len = REACH * f;
  return { x: +(CENTER + Math.cos(angle) * len).toFixed(2), y: +(CENTER + Math.sin(angle) * len).toFixed(2) };
});

export function ClaudeMark({ size = 14 }: { size?: number }) {
  return (
    <svg className="claude-mark" role="img" aria-label="Claude" width={size} height={size} viewBox="0 0 100 100">
      <g stroke="var(--claude-accent)" strokeWidth={STROKE} strokeLinecap="round">
        {RAYS.map((r, i) => (
          <line key={i} x1={CENTER} y1={CENTER} x2={r.x} y2={r.y} />
        ))}
      </g>
    </svg>
  );
}
