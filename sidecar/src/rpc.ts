import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { HostCommand, SidecarEvent } from '../../protocol/src/index';

export function readCommands(
  input: Readable,
  onCommand: (cmd: HostCommand) => void,
  onBadLine: (line: string, err: unknown) => void,
): readline.Interface {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let cmd: HostCommand;
    try {
      cmd = JSON.parse(line);
    } catch (err) {
      onBadLine(line, err);
      return;
    }
    onCommand(cmd);
  });
  return rl;
}

export function createEmitter(out: Writable): (ev: SidecarEvent) => void {
  return (ev) => {
    out.write(JSON.stringify(ev) + '\n');
  };
}
