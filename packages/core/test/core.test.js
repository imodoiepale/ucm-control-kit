import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  AlertEngine, diagnose, diffSnapshots, inSubnet, nameScore, parseUptime,
  reconcile, runAudit, summarise, takeSnapshot, testCall,UcmClient, 
} from '../src/index.js';
import { startFakeUcm } from './fake-ucm.js';

let ucm;
before(async () => { ucm = await startFakeUcm(); });
after(() => ucm.close());

const client = (extra = {}) => new UcmClient({ host: ucm.host, user: 'api', password: 'secret', ...extra });

test('logs in and reads every page of extensions', async () => {
  const exts = await client().extensions();
  assert.equal(exts.length, 5);
  assert.deepEqual(
    { ext: exts[0].extension, ip: exts[0].ip, model: exts[0].model, registered: exts[0].registered },
    { ext: '1001', ip: '10.10.1.20', model: 'GXP1615', registered: true },
  );
  assert.equal(exts[1].registered, false);
  assert.equal(exts[1].ip, null);
});

test('rejects a wrong password with status -37', async () => {
  await assert.rejects(new UcmClient({ host: ucm.host, user: 'api', password: 'nope' }).systemStatus(), { status: -37 });
});

test('logs in again when the session expires', async () => {
  const c = client();
  await c.systemStatus();
  ucm.state.sessions.clear();
  const info = await c.systemInfo();
  assert.equal(info['prog-version'], '1.0.33.30');
});

test('refuses write actions that are not allow-listed', async () => {
  await assert.rejects(client().dialExtension('1001', '1003'), /not in allowWrites/);
  await assert.rejects(client().call('rebootSystem'), /not in allowWrites/);
});

test('dry run records writes without sending them', async () => {
  const audit = [];
  const before = ucm.state.writes.length;
  const res = await client({ allowWrites: ['updateSIPAccount'], dryRun: true, onAudit: (e) => audit.push(e) })
    .call('updateSIPAccount', { extension: '1002', fullname: 'x' });
  assert.equal(res.dryRun, true);
  assert.equal(ucm.state.writes.length, before);
  assert.equal(audit.at(-1).dryRun, true);
});

test('audit reports missing permissions', async () => {
  const report = await runAudit(client(), { actions: ['getSystemGeneralStatus', 'listAccount', 'listRingGroup'] });
  assert.deepEqual(report.missingPermissions, ['listRingGroup']);
  assert.equal(report.platform.firmware, '1.0.33.30');
  assert.equal(report.results.find((r) => r.action === 'listAccount').count, 5);
});

test('name matching handles abbreviations and extra words', () => {
  assert.equal(nameScore('Harbour Road', 'Harbour Road'), 1);
  assert.ok(nameScore('Kisumu Central', 'KSM Central') >= 0.9);
  assert.ok(nameScore('Hill', 'Hill Annex') >= 0.75);
  assert.ok(nameScore('Hill Street', 'Reception') < 0.5);
  assert.ok(nameScore('Lake View Store', 'Lake View Mall') < 0.75);
  assert.ok(inSubnet('10.10.1.20', '10.10.1.0/24'));
  assert.ok(!inSubnet('10.10.2.20', '10.10.1.0/24'));
});

test('reconcile classifies ok, changed, found, conflict, missing, ambiguous and unassigned', async () => {
  const accounts = await client().extensions();
  const sites = [
    { id: 'a', name: 'Harbour Road', extension: '1001' },
    { id: 'b', name: 'Hill Street', extension: '1009' },
    { id: 'c', name: 'Lake View Mall' },
    { id: 'd', name: 'Kisumu Central', extension: '1004' },
    { id: 'e', name: 'Old Depot', extension: '1099' },
    { id: 'f', name: 'Harbour Road Backup', extension: '1001' },
  ];
  const { sites: r, unassigned, summary } = reconcile(sites, accounts);
  const kind = Object.fromEntries(r.map((x) => [x.siteId, x.kind]));
  assert.deepEqual(kind, { a: 'ok', b: 'changed', c: 'found', d: 'changed', e: 'missing', f: 'ok' });
  assert.equal(r.find((x) => x.siteId === 'b').proposed, '1002');
  assert.equal(r.find((x) => x.siteId === 'd').proposed, '1005');
  assert.deepEqual(unassigned.map((a) => a.extension), ['1004']);
  assert.equal(summary.unassigned, 1);

  const conflict = reconcile([{ id: 'x', name: 'Nowhere', extension: '1004' }], accounts).sites[0];
  assert.equal(conflict.kind, 'conflict');

  const tie = reconcile([{ id: 'p', name: 'Lake View Mall' }, { id: 'q', name: 'Lake View Mall', aliases: [] }], accounts).sites;
  assert.deepEqual(tie.map((x) => x.kind), ['ambiguous', 'ambiguous']);
});

test('snapshot diff raises offline, online, removed and reboot events', async () => {
  const c = client();
  const s1 = await takeSnapshot(c);
  assert.deepEqual(summarise(s1), { pbxUp: true, firmware: '1.0.33.30', extensions: 5, online: 4, offline: 1, trunks: 0, trunksDown: 0, activeCalls: 0, ringing: 0 });

  const saved = structuredClone(ucm.state.accounts);
  ucm.state.accounts[0].status = 'Unavailable';
  ucm.state.accounts[1].status = 'Idle';
  ucm.state.accounts.pop();
  ucm.state.system.status['up-time'] = '00:01:00';
  const s2 = await takeSnapshot(c);
  const types = diffSnapshots(s1, s2).map((e) => `${e.type}:${e.extension ?? ''}`).sort();
  assert.deepEqual(types, ['extension.offline:1001', 'extension.online:1002', 'extension.removed:1005', 'pbx.rebooted:']);
  ucm.state.accounts = saved;
  ucm.state.system.status['up-time'] = '2 03:04:05';
});

test('alert engine waits out the grace period and drops blips', () => {
  let now = 0;
  const engine = new AlertEngine({ graceMs: 1000, now: () => now });
  const off = { type: 'extension.offline', severity: 'warning', extension: '1' };
  const on = { type: 'extension.online', severity: 'info', extension: '1' };
  assert.deepEqual(engine.push([off]), []);
  assert.deepEqual(engine.push([on]), []);
  engine.push([off]);
  now = 1500;
  assert.deepEqual(engine.tick(), [off]);
  assert.deepEqual(engine.push([{ type: 'pbx.down', severity: 'critical' }]).length, 1);
});

test('diagnose picks the smallest fix', () => {
  const site = { name: 'Hill Street', extension: '1002' };
  assert.equal(diagnose({ site, account: null, network: { reachable: false } }).cause, 'network');
  assert.equal(diagnose({ site, account: { registered: true }, network: { reachable: false } }).cause, 'healthy');
  assert.equal(diagnose({ site: { name: 'x' }, account: null }).cause, 'no-extension');
  const missing = diagnose({ site, account: null, known: { extension: '1002', fullname: 'Hill Street', status: 'Idle', ip: '1.2.3.4' } });
  assert.equal(missing.cause, 'extension-missing');
  assert.deepEqual(missing.steps[0].params, { extension: '1002', fullname: 'Hill Street' });
  const drift = diagnose({ site, account: { registered: false }, known: { fullname: 'Hill Street', nat: 'yes', secret: '' }, liveSettings: { fullname: 'Hill St', nat: 'yes', secret: 'x' } });
  assert.equal(drift.cause, 'drift');
  assert.deepEqual(drift.steps[0].params, { extension: '1002', fullname: 'Hill Street' });
  assert.equal(diagnose({ site, account: { registered: false }, known: { ip: '10.1.1.9' } }).cause, 'phone-side');
  assert.equal(diagnose({ site, account: { registered: true } }).cause, 'healthy');
});

test('test call connects two registered phones and refuses offline ones', async () => {
  const c = client({ allowWrites: ['dialExtension'] });
  const ok = await testCall(c, { from: '1001', to: '1003', sleep: async () => {}, timeoutMs: 1000 });
  assert.equal(ok.outcome, 'connected');
  const offline = await testCall(c, { from: '1002', to: '1003', sleep: async () => {} });
  assert.equal(offline.outcome, 'failed');
  assert.match(offline.message, /no registered phone/);
});

test('uptime parser', () => {
  assert.equal(parseUptime('20:12:07'), 72727);
  assert.equal(parseUptime('5 00:49:28'), 5 * 86400 + 2968);
  assert.equal(parseUptime('bad'), null);
});

test('call report tallies per site, direction and route', async () => {
  const { fetchCdr, tallyCalls, reportToCsv } = await import('../src/index.js');
  const c = client();
  const calls = await fetchCdr(c, { from: new Date('2026-01-05'), to: new Date('2026-01-06'), pageSize: 2 });
  assert.equal(calls.length, 5);
  const report = tallyCalls(calls, {
    extensions: await c.extensions(),
    sites: [{ name: 'Harbour', extension: '1001' }, { name: 'Lake View', extension: '1003' }, { name: 'Hill', extension: '1002' }],
  });
  assert.deepEqual(
    { calls: report.totals.calls, answered: report.totals.answered, missed: report.totals.missed, busy: report.totals.busy, internal: report.totals.internal, inbound: report.totals.inbound, outbound: report.totals.outbound, talk: report.totals.talkMinutes },
    { calls: 5, answered: 3, missed: 1, busy: 1, internal: 3, inbound: 1, outbound: 1, talk: 8 },
  );
  const harbour = report.sites.find((s) => s.name === 'Harbour');
  assert.deepEqual({ made: harbour.made, received: harbour.received, answered: harbour.answered }, { made: 2, received: 1, answered: 1 });
  const lake = report.sites.find((s) => s.name === 'Lake View');
  assert.equal(lake.received, 2);
  assert.equal(lake.answerRate, 1);
  assert.deepEqual(report.quiet, ['Hill']);
  assert.equal(report.topRoutes[0].count, 1);
  assert.equal(report.byHour[9], 2);
  assert.match(reportToCsv(report), /^site,extensions,made/);
});

test('admin edit previews, validates, applies and verifies', async () => {
  const { planExtensionEdit, applyExtensionEdit, runTool } = await import('../src/index.js');
  const c = client({ allowWrites: ['updateSIPAccount', 'applyChanges'] });
  const settings = await c.sipAccount('1002');
  assert.equal(settings.secret, '(set)', 'SIP password never leaves the client');
  assert.equal(settings.vmsecret, '(set)');
  const bad = await planExtensionEdit(c, '1002', { fullname: '', secret: 'x' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);

  const plan = await planExtensionEdit(c, '1002', { fullname: 'Hill Street Shop', permission: 'internal' });
  assert.deepEqual(plan.diff.map((d) => d.field), ['fullname']);
  const writes = ucm.state.writes.length;
  const done = await applyExtensionEdit(c, plan, { actor: 'it-admin' });
  assert.equal(done.applied, true);
  assert.equal(ucm.state.writes.at(-1).action, 'applyChanges');
  assert.equal(ucm.state.writes.length, writes + 2);

  const preview = await runTool(c, 'update_extension', { extension: '1002', changes: { fullname: 'Hill Street' } });
  assert.equal(preview.preview, true);
  assert.equal(preview.diff[0].to, 'Hill Street');
  await assert.rejects(runTool(c, 'update_extension', { extension: '1002', changes: { fullname: 'X' }, confirm: true }, { isAdmin: false }), /admin/);
  const applied = await runTool(c, 'update_extension', { extension: '1002', changes: { fullname: 'Hill Street' }, confirm: true }, { isAdmin: true, actor: 'it' });
  assert.equal(applied.applied, true);
});
