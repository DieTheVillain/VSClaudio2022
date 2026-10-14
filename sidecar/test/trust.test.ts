import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isTrusted, isTrustedOnDisk } from '../src/trust';

const trusted = (...keys: string[]) => ({
  projects: Object.fromEntries(keys.map((k) => [k, { hasTrustDialogAccepted: true }])),
});

test('an exact project match is trusted', () => {
  expect(isTrusted('C:\\src\\App', trusted('C:\\src\\App'))).toBe(true);
});

test('a folder under a trusted project is trusted', () => {
  expect(isTrusted('C:\\src\\App\\sub\\deep', trusted('C:/src/App'))).toBe(true);
});

test('slashes, drive-letter case, path case and trailing slashes are normalized', () => {
  expect(isTrusted('c:\\SRC\\app\\', trusted('C:/src/App'))).toBe(true);
  expect(isTrusted('C:/src/App', trusted('c:\\src\\app\\'))).toBe(true);
});

test('an untrusted or sibling folder is not trusted', () => {
  expect(isTrusted('C:\\src\\Other', trusted('C:/src/App'))).toBe(false);
  expect(isTrusted('C:\\src\\AppTwo', trusted('C:/src/App'))).toBe(false);
  expect(isTrusted('C:\\src\\App', { projects: { 'C:/src/App': { hasTrustDialogAccepted: false } } })).toBe(false);
  expect(isTrusted('C:\\src\\App', { projects: { 'C:/src/App': {} } })).toBe(false);
});

test('a missing or malformed projects object is not trusted', () => {
  expect(isTrusted('C:\\src\\App', {})).toBe(false);
  expect(isTrusted('C:\\src\\App', null)).toBe(false);
  expect(isTrusted('C:\\src\\App', { projects: 'x' })).toBe(false);
  expect(isTrusted('C:\\src\\App', { projects: { 'C:/src/App': null } })).toBe(false);
});

test('the disk loader reads .claude.json from home and treats missing or broken files as untrusted', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vsclaudio-trust-'));
  try {
    expect(isTrustedOnDisk('C:\\src\\App', home)).toBe(false);
    fs.writeFileSync(path.join(home, '.claude.json'), '{ not json');
    expect(isTrustedOnDisk('C:\\src\\App', home)).toBe(false);
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify(trusted('C:/src/App')));
    expect(isTrustedOnDisk('C:\\src\\App', home)).toBe(true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
