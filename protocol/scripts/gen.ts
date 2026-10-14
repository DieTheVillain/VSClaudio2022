import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '../src/index';
import { samples } from '../src/samples';

const dir = join(import.meta.dir, '..', 'fixtures');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'samples.json'), JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...samples }, null, 2) + '\n', 'utf8');
console.log('wrote fixtures/samples.json');
