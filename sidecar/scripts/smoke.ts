import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

const exe = path.resolve(import.meta.dir, '..', '..', 'vsix', 'sidecar', 'vsclaudio-sidecar.exe');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vsclaudio-smoke-'));
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const seen: string[] = [];
const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
const timer = setTimeout(() => { console.log('FAIL timeout; saw', seen.join(',')); child.kill(); process.exit(1); }, 120_000);

readline.createInterface({ input: child.stdout }).on('line', (raw) => {
  const ev = JSON.parse(raw);
  seen.push(ev.t);
  if (ev.t === 'ready') send({ t: 'send', text: 'Reply with exactly: PONG' });
  if (ev.t === 'error') { console.log('FAIL', raw); process.exit(1); }
  if (ev.t === 'turn_end') {
    clearTimeout(timer);
    const ok = ev.status === 'success' && seen.includes('session') && seen.includes('block_delta');
    console.log(ok ? 'PASS' : 'FAIL', raw, 'events:', [...new Set(seen)].join(','));
    send({ t: 'shutdown' });
    setTimeout(() => process.exit(ok ? 0 : 1), 500);
  }
});
send({ t: 'hello', protocol: 1, cwd });
