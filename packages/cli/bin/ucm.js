#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  AlertEngine, applyExtensionEdit, clientFromEnv, diagnose, diffSnapshots,
  fetchCdr, planExtensionEdit, reconcile, reportToCsv, runAudit, summarise, TESTED_PLATFORM, takeSnapshot,
  tallyCalls, testCall,
} from '@ucm-control-kit/core';
import { periodRange } from '@ucm-control-kit/core/tools';

const HELP = `ucm - control a Grandstream UCM from the terminal

Environment:
  UCM_HOST          e.g. 192.168.1.10:8089
  UCM_USER          API user (UCM > Integrations > API Configuration > API Settings (New))
  UCM_PASSWORD      API user password (prompted if unset)
  UCM_ALLOW_WRITES  comma list of write actions allowed, e.g. dialExtension
  UCM_DRY_RUN=1     print writes instead of sending them

Commands:
  status                       PBX health summary
  extensions [--offline]       list extensions and registration
  audit [--out dir]            call every read action, report permissions
  probe                        check optional actions (getSIPAccount, cdrapi) on this firmware
  reconcile --registry f.json  compare your site list with the PBX
  diagnose <ext>               explain why an extension is not working
  call <from> <to>             place a test call (needs UCM_ALLOW_WRITES=dialExtension)
  calls [--period today|yesterday|week|month] [--registry f.json] [--csv file]
                               call report per site/person
  edit <ext> field=value ...   preview an extension change; add --apply to send it
                               (needs UCM_ALLOW_WRITES=updateSIPAccount,applyChanges)
  watch [--interval 30]        live alerts
  platform                     show the tested platform

Add --json to any command for machine-readable output.
Tested on ${TESTED_PLATFORM.model} firmware ${TESTED_PLATFORM.firmware}.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean' },
    offline: { type: 'boolean' },
    out: { type: 'string' },
    registry: { type: 'string' },
    period: { type: 'string', default: 'today' },
    csv: { type: 'string' },
    apply: { type: 'boolean' },
    interval: { type: 'string', default: '30' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, ...args] = positionals;

const print = (human, data) => {
  if (opts.json) console.log(JSON.stringify(data, null, 2));
  else console.log(human);
};

async function password() {
  if (process.env.UCM_PASSWORD) return process.env.UCM_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Set UCM_PASSWORD');
  process.stdout.write('UCM API password: ');
  process.stdin.setRawMode(true);
  let pw = '';
  for await (const chunk of process.stdin) {
    for (const ch of chunk.toString()) {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdout.write('\n'); process.stdin.pause(); return pw; }
      if (ch === '\u0003') process.exit(130);
      pw = ch === '\u007f' || ch === '\b' ? pw.slice(0, -1) : pw + ch;
    }
  }
  return pw;
}

async function loadSites(file) {
  const raw = JSON.parse((await readFile(file, 'utf8')).trimStart());
  return Array.isArray(raw) ? raw : raw.branches ?? raw.sites ?? [];
}

async function main() {
  if (!cmd || opts.help) return console.log(HELP);
  if (cmd === 'platform') return print(`Tested: ${TESTED_PLATFORM.model} ${TESTED_PLATFORM.firmware}`, TESTED_PLATFORM);
  if (!process.env.UCM_HOST || !process.env.UCM_USER) throw new Error('Set UCM_HOST and UCM_USER (see ucm --help)');

  const client = clientFromEnv({ ...process.env, UCM_PASSWORD: await password() });
  try {
    switch (cmd) {
      case 'status': {
        const snap = await takeSnapshot(client);
        const s = summarise(snap);
        return print(
          `${snap.pbx.model ?? 'UCM'} fw ${s.firmware ?? '?'}  ${s.pbxUp ? 'UP' : 'DOWN'}\n` +
          `extensions ${s.online}/${s.extensions} registered, ${s.offline} offline\n` +
          `trunks ${s.trunks} (${s.trunksDown} down)   calls ${s.activeCalls} active, ${s.ringing} ringing`,
          { summary: s, pbx: snap.pbx, errors: snap.errors },
        );
      }
      case 'extensions': {
        let rows = await client.extensions();
        if (opts.offline) rows = rows.filter((r) => !r.registered);
        return print(rows.map((r) => `${r.registered ? '●' : '○'} ${r.extension.padEnd(6)} ${r.name.padEnd(24)} ${r.ip ?? '-'} ${r.model ?? ''}`).join('\n'), rows);
      }
      case 'audit': {
        const report = await runAudit(client, { includeData: Boolean(opts.out) });
        if (opts.out) await writeFile(opts.out, JSON.stringify(report, null, 2));
        return print(
          report.results.map((r) => `${r.status === 0 ? 'ok ' : 'ERR'} ${r.action.padEnd(24)} ${r.count ?? ''} ${r.error ?? ''}`).join('\n') +
          (report.missingPermissions.length ? `\n\nGrant these on the API user: ${report.missingPermissions.join(', ')}` : ''),
          { ...report, results: report.results.map(({ data, ...r }) => r) },
        );
      }
      case 'probe': {
        const exts = await client.extensions();
        const ext = exts[0]?.extension;
        const out = {};
        for (const [name, fn] of [
          ['getSIPAccount', () => client.sipAccount(ext)],
          ['cdrapi', () => client.call('cdrapi', { format: 'json', numRecords: '1' })],
          ['listZeroConfig', () => client.call('listZeroConfig')],
        ]) {
          try {
            const r = await fn();
            const records = r?.cdr_root ?? r?.cdr;
            out[name] = { ok: true, fields: Object.keys(r ?? {}), ...(records ? { records: records.length, recordFields: Object.keys(records[0]?.main_cdr ?? records[0] ?? {}) } : {}) };
          }
          catch (e) { out[name] = { ok: false, status: e.status ?? null, error: e.message }; }
        }
        return print(Object.entries(out).map(([k, v]) => `${v.ok ? 'ok ' : 'ERR'} ${k.padEnd(16)} ${v.ok ? (v.recordFields ? `${v.records} record(s): ${v.recordFields.join(', ')}` : v.fields.join(', ')) : v.error}`).join('\n'), out);
      }
      case 'reconcile': {
        if (!opts.registry) throw new Error('reconcile needs --registry <file.json> (array of {id,name,aliases,extension,subnet} or {branches:[...]})');
        const sites = await loadSites(opts.registry);
        const result = reconcile(sites, await client.extensions());
        const lines = result.sites.filter((r) => r.kind !== 'ok').map((r) =>
          `${r.kind.padEnd(10)} ${r.site.padEnd(26)} ${(r.current.join('/') || '-').padEnd(10)} ${r.proposed ? `-> ${r.proposed} (${r.account.name}, ${r.confidence})` : r.evidence?.join('; ') ?? ''}`);
        lines.push('', `summary ${JSON.stringify(result.summary)}`);
        if (result.unassigned.length) lines.push(`unassigned: ${result.unassigned.map((a) => `${a.extension} ${a.name}`).join(', ')}`);
        return print(lines.join('\n'), result);
      }
      case 'diagnose': {
        const [ext] = args;
        const account = (await client.extensions()).find((e) => e.extension === String(ext)) ?? null;
        const d = diagnose({ site: { name: account?.name ?? `extension ${ext}`, extension: ext }, account });
        return print(`${d.cause}: ${d.summary}\n${d.steps.map((s) => `  - ${s.action}${s.write ? ' (write)' : ''}: ${s.why}`).join('\n')}`, d);
      }
      case 'call': {
        const [from, to] = args;
        if (!from || !to) throw new Error('usage: ucm call <from> <to>');
        const r = await testCall(client, { from, to, onProgress: (p) => opts.json || console.error(`… ${p.stage}`) });
        process.exitCode = r.passed ? 0 : 1;
        return print(`${r.outcome}: ${r.message}`, r);
      }
      case 'calls': {
        const range = periodRange(opts.period);
        const sites = opts.registry ? await loadSites(opts.registry) : [];
        const report = tallyCalls(await fetchCdr(client, range), { extensions: await client.extensions(), sites });
        if (opts.csv) await writeFile(opts.csv, reportToCsv(report));
        const t = report.totals;
        return print([
          `${range.from.toISOString()} to ${range.to.toISOString()}`,
          `${t.calls} calls, ${t.answered} answered, ${t.missed} missed, ${t.busy} busy, ${t.talkMinutes} min talk`,
          `internal ${t.internal}, inbound ${t.inbound}, outbound ${t.outbound}`,
          '',
          'site                        made  recv  ans  miss  min  top partner',
          ...report.sites.map((s) => `${s.name.slice(0, 26).padEnd(26)} ${String(s.made).padStart(5)} ${String(s.received).padStart(5)} ${String(s.answered).padStart(4)} ${String(s.missed).padStart(5)} ${String(s.talkMinutes).padStart(4)}  ${s.topPartners[0]?.name ?? ''}`),
          ...(report.quiet.length ? ['', `no calls: ${report.quiet.join(', ')}`] : []),
        ].join('\n'), report);
      }
      case 'edit': {
        const [ext, ...pairs] = args;
        if (!ext || !pairs.length) throw new Error('usage: ucm edit <ext> field=value [...] [--apply]');
        const changes = Object.fromEntries(pairs.map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
        const plan = await planExtensionEdit(client, ext, changes);
        if (!plan.ok) throw new Error(plan.errors.join('; '));
        if (!opts.apply || plan.noChange) {
          return print(plan.noChange ? 'nothing to change' : `${plan.diff.map((d) => `${d.field}: "${d.from ?? ''}" -> "${d.to}"`).join('\n')}\n\nre-run with --apply to send`, plan);
        }
        const done = await applyExtensionEdit(client, plan, { actor: process.env.USER ?? process.env.USERNAME ?? 'cli' });
        process.exitCode = done.applied ? 0 : 1;
        return print(done.message, done);
      }
      case 'watch': {
        const engine = new AlertEngine();
        let prev = null;
        const every = Number(opts.interval) * 1000;
        console.error(`watching every ${opts.interval}s, Ctrl+C to stop`);
        for (;;) {
          const snap = await takeSnapshot(client);
          const alerts = engine.push(prev ? diffSnapshots(prev, snap) : []);
          if (!prev) console.error(JSON.stringify(summarise(snap)));
          for (const a of alerts) print(`${a.at} ${a.severity.toUpperCase().padEnd(8)} ${a.type} ${a.extension ?? a.trunk ?? ''} ${a.name ?? ''} ${a.detail ?? ''}`, a);
          prev = snap;
          await new Promise((r) => setTimeout(r, every));
        }
      }
      default:
        throw new Error(`Unknown command "${cmd}". Run ucm --help`);
    }
  } finally {
    if (cmd !== 'watch') await client.logout();
  }
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
