import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startFakeUcm } from '../../core/test/fake-ucm.js';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/ucm.js', import.meta.url));
let ucm;
let env;
before(async () => {
  ucm = await startFakeUcm();
  env = { ...process.env, UCM_HOST: ucm.host, UCM_USER: 'api', UCM_PASSWORD: 'secret' };
});
after(() => ucm.close());

const ucmCli = async (args, extra = {}) => {
  const { stdout } = await run(process.execPath, [BIN, ...args, '--json'], { env: { ...env, ...extra } });
  return JSON.parse(stdout);
};

test('status', async () => {
  const r = await ucmCli(['status']);
  assert.equal(r.summary.online, 4);
});

test('extensions --offline', async () => {
  const r = await ucmCli(['extensions', '--offline']);
  assert.deepEqual(r.map((e) => e.extension), ['1002']);
});

test('reconcile reads a registry file', async () => {
  const file = join(tmpdir(), `ucm-sites-${process.pid}.json`);
  await writeFile(file, JSON.stringify({ branches: [{ id: 'x', name: 'Hill Street', extension: '1009' }] }));
  const r = await ucmCli(['reconcile', '--registry', file]);
  assert.equal(r.sites[0].kind, 'changed');
  assert.equal(r.sites[0].proposed, '1002');
});

test('call is refused without UCM_ALLOW_WRITES and works with it', async () => {
  await assert.rejects(ucmCli(['call', '1001', '1003']));
  const r = await ucmCli(['call', '1001', '1003'], { UCM_ALLOW_WRITES: 'dialExtension' });
  assert.equal(r.outcome, 'connected');
});

test('calls report and edit preview/apply', async () => {
  const r = await ucmCli(['calls', '--period', 'month']);
  assert.ok(r.totals);
  const preview = await ucmCli(['edit', '1004', 'fullname=Front Desk']);
  assert.equal(preview.diff[0].to, 'Front Desk');
  await assert.rejects(ucmCli(['edit', '1004', 'fullname=Front Desk', '--apply']));
  const done = await ucmCli(['edit', '1004', 'fullname=Front Desk', '--apply'], { UCM_ALLOW_WRITES: 'updateSIPAccount,applyChanges' });
  assert.equal(done.applied, true);
});
