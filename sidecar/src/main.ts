import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { findClaude } from './findClaude';
import { createEmitter, readCommands } from './rpc';
import { SessionController, type QueryFn } from './session';
import { isTrustedOnDisk } from './trust';

const emit = createEmitter(process.stdout);
const log = (s: string) => process.stderr.write(s.endsWith('\n') ? s : s + '\n');
const controller = new SessionController({
  query: query as unknown as QueryFn,
  emit,
  findClaude: (explicit) => findClaude(explicit, { env: process.env, home: os.homedir(), exists: fs.existsSync }),
  isTrusted: (cwd) => isTrustedOnDisk(cwd, os.homedir()),
  log,
});

let exiting = false;
function exitSoon() {
  if (exiting) return;
  exiting = true;
  // Give the SDK a moment to stop the CLI child cleanly.
  setTimeout(() => process.exit(0), 300);
}

readCommands(
  process.stdin,
  (cmd) => {
    controller.handle(cmd).catch((e) => log(`command ${cmd.t} failed: ${e}`));
    if (cmd.t === 'shutdown') exitSoon();
  },
  (line) => log(`ignored malformed command: ${line.slice(0, 200)}`),
);
process.stdin.on('end', () => {
  void controller.handle({ t: 'shutdown' });
  exitSoon();
});
