import { filterEscalatingDefaultMode, resolveSettings } from '@anthropic-ai/claude-agent-sdk';

// The user's permissions.defaultMode as the CLI would honour it for this folder: an escalating mode
// set by repo-committed project settings is dropped, the same trust filter the CLI applies.
export async function resolveDefaultMode(cwd: string): Promise<unknown> {
  const settings = filterEscalatingDefaultMode(await resolveSettings({ cwd }));
  return settings.permissions?.defaultMode;
}
