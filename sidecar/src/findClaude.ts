import * as path from 'node:path';

export interface FindDeps {
  env: Record<string, string | undefined>;
  home: string;
  exists: (p: string) => boolean;
}

// Order: explicit host setting, env override, the native installer's location, then PATH.
export function findClaude(explicit: string | undefined, deps: FindDeps): string | null {
  const pathVar = deps.env.PATH ?? deps.env.Path ?? '';
  const candidates = [
    explicit,
    deps.env.VSCLAUDIO_CLAUDE_PATH,
    path.win32.join(deps.home, '.local', 'bin', 'claude.exe'),
    ...pathVar.split(';').filter(Boolean).map((dir) => path.win32.join(dir, 'claude.exe')),
  ];
  for (const c of candidates) if (c && deps.exists(c)) return c;
  return null;
}
