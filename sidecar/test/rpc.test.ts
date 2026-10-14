import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { createEmitter, readCommands } from '../src/rpc';
import type { HostCommand } from '../../protocol/src/index';

test('readCommands parses one command per line and skips blanks', async () => {
  const input = new PassThrough();
  const got: HostCommand[] = [];
  const bad: string[] = [];
  readCommands(input, (c) => got.push(c), (l) => bad.push(l));
  input.write('{"t":"send","text":"café 🚀"}\n\n{"t":"interrupt"}\nnot json\n');
  input.end();
  await new Promise((r) => setTimeout(r, 20));
  expect(got).toEqual([{ t: 'send', text: 'café 🚀' }, { t: 'interrupt' }]);
  expect(bad).toEqual(['not json']);
});

test('createEmitter writes newline-delimited JSON', () => {
  const out = new PassThrough();
  const chunks: string[] = [];
  out.on('data', (d) => chunks.push(String(d)));
  const emit = createEmitter(out);
  emit({ t: 'ready', protocol: 1 });
  emit({ t: 'block_delta', key: 'm:0', text: 'a\nb' });
  expect(chunks.join('')).toBe('{"t":"ready","protocol":1}\n{"t":"block_delta","key":"m:0","text":"a\\nb"}\n');
});
