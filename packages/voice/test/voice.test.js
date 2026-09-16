import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { exportTools, UcmClient } from '@ucm-control-kit/core';
import { startFakeUcm } from '../../core/test/fake-ucm.js';
import { parseIntent } from '../src/intents.js';
import { createVoiceServer } from '../src/server.js';

test('parses spoken commands', () => {
  const cases = {
    'Which phones are offline?': ['list_extensions', { offline_only: true }],
    'is the PBX healthy': ['pbx_status', {}],
    'test call from Harbour Road to Hill Street': ['test_call', { from: 'Harbour Road', to: 'Hill Street' }],
    'call 1001 to 1003': ['test_call', { from: '1001', to: '1003' }],
    'what is the phone status at the Lake View branch': ['extension_status', { extension: 'Lake View' }],
    'is extension 1004 working': ['extension_status', { extension: '1004' }],
    'who is on a call right now': ['active_calls', {}],
    'which branch extensions are out of date': ['reconcile_sites', {}],
  };
  for (const [text, [tool, args]] of Object.entries(cases)) {
    assert.deepEqual(parseIntent(text), { kind: 'tool', tool, args }, text);
  }
  assert.equal(parseIntent('yes go ahead').kind, 'confirm');
  assert.equal(parseIntent('cancel').kind, 'cancel');
  assert.equal(parseIntent('sing me a song'), null);
});

test('exports tool schemas for every voice platform', () => {
  assert.equal(exportTools('openai')[0].type, 'function');
  assert.ok(exportTools('anthropic')[0].input_schema);
  assert.ok(exportTools('gemini')[0].functionDeclarations.length > 3);
  assert.equal(exportTools('elevenlabs')[0].type, 'client');
  assert.throws(() => exportTools('nope'));
});

let ucm;
let base;
let server;
before(async () => {
  ucm = await startFakeUcm();
  const client = new UcmClient({ host: ucm.host, user: 'api', password: 'secret', allowWrites: ['dialExtension'] });
  server = createVoiceServer({ client });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await ucm.close(); });

const post = (path, body) => fetch(base + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

test('voice round trip: status, then a confirmed test call', async () => {
  const status = await post('/api/say', { text: 'how are the phones' });
  assert.match(status.reply, /4 of 5 phones are registered/);

  const ask = await post('/api/say', { text: 'test call from 1001 to 1003' });
  assert.equal(ask.needsConfirmation, true);
  assert.equal(ucm.state.writes.length, 0);

  const done = await post('/api/run', { tool: ask.intent.tool, args: { ...ask.intent.args, confirm: true } });
  assert.equal(done.result.outcome, 'connected');
  assert.equal(ucm.state.writes.at(-1).action, 'dialExtension');
});

test('serves the console page', async () => {
  const html = await fetch(base).then((r) => r.text());
  assert.match(html, /UCM Voice Console/);
});

test('parses call report and rename commands', () => {
  assert.deepEqual(parseIntent('how many calls did each branch make today'), { kind: 'tool', tool: 'call_report', args: { period: 'today' } });
  assert.deepEqual(parseIntent('call report for Harbour Road this week'), { kind: 'tool', tool: 'call_report', args: { period: 'week', site: 'Harbour Road' } });
  assert.deepEqual(parseIntent('rename extension 1004 to Front Desk'), { kind: 'tool', tool: 'update_extension', args: { extension: '1004', changes: { fullname: 'Front Desk' } } });
});
