import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { UcmClient } from '@ucm-control-kit/core';
import { startFakeUcm } from '../../core/test/fake-ucm.js';
import { createServer } from '../src/server.js';

let ucm;
let mcp;
before(async () => {
  ucm = await startFakeUcm();
  const client = new UcmClient({ host: ucm.host, user: 'api', password: 'secret', allowWrites: ['dialExtension'] });
  const server = await createServer({ client, sites: [{ id: 'h', name: 'Harbour', aliases: ['Harbour Road'], extension: '1001' }] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  mcp = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
});
after(async () => { await mcp.close(); await ucm.close(); });

const call = async (name, args = {}) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);

test('lists every tool with read-only hints', async () => {
  const { tools } = await mcp.listTools();
  assert.ok(tools.find((t) => t.name === 'pbx_status').annotations.readOnlyHint);
  assert.equal(tools.find((t) => t.name === 'test_call').annotations.readOnlyHint, false);
});

test('pbx_status and offline list', async () => {
  assert.equal((await call('pbx_status')).offline, 1);
  const off = await call('list_extensions', { offline_only: true });
  assert.deepEqual(off.extensions.map((e) => e.extension), ['1002']);
});

test('extension_status resolves a site alias', async () => {
  const r = await call('extension_status', { extension: 'Harbour Road' });
  assert.equal(r.account.extension, '1001');
  assert.equal(r.diagnosis.cause, 'healthy');
});

test('test_call needs confirmation, then connects', async () => {
  const pending = await call('test_call', { from: '1001', to: '1003', confirm: false });
  assert.equal(pending.needsConfirmation, true);
  const done = await call('test_call', { from: 'Harbour', to: 'Lake View Mall', confirm: true });
  assert.equal(done.outcome, 'connected');
});

test('ambiguous names are refused, not guessed', async () => {
  const res = await mcp.callTool({ name: 'extension_status', arguments: { extension: 'l' } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /matches \d+ extensions/);
});
