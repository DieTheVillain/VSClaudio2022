import * as fs from 'node:fs';
import * as path from 'node:path';

// Windows paths compare case-insensitively and may be stored with either separator.
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Whether Claude Code's workspace-trust dialog has been accepted for `cwd` or one of its
 * ancestors, as recorded in ~/.claude.json (`projects[<path>].hasTrustDialogAccepted`).
 * Headless SDK sessions skip that dialog, so without this check a repository's own hooks
 * would run as soon as its folder opens.
 */
export function isTrusted(cwd: string, claudeJson: unknown): boolean {
  const projects = (claudeJson as { projects?: unknown } | null)?.projects;
  if (!projects || typeof projects !== 'object') return false;
  const trusted = new Set<string>();
  for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
    if ((value as { hasTrustDialogAccepted?: unknown } | null)?.hasTrustDialogAccepted === true) trusted.add(normalize(key));
  }
  let dir = normalize(cwd);
  while (dir) {
    if (trusted.has(dir)) return true;
    const cut = dir.lastIndexOf('/');
    if (cut < 0) return false;
    dir = dir.slice(0, cut).replace(/\/+$/, '');
  }
  return false;
}

export function isTrustedOnDisk(cwd: string, home: string): boolean {
  try {
    return isTrusted(cwd, JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')));
  } catch {
    return false;
  }
}
