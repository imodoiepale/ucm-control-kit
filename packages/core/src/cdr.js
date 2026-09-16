/**
 * Call detail records: fetch from the UCM and tally them per site and per person.
 *
 * The UCM `cdrapi` action returns records under `cdr_root`. A record can hold
 * `main_cdr` plus `sub_cdr_N` legs for transferred or multi-leg calls. We keep the
 * main leg (or the record itself) so each call is counted once.
 *
 * Record fields used (as documented by Grandstream, verify with `ucm probe`):
 *   start, answer, end, src, dst, clid, disposition, duration, billsec, AcctId, uniqueid
 */

const pad = (n) => String(n).padStart(2, '0');
export const ucmTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * @param {import('./client.js').UcmClient} client
 * @param {{ from: Date, to: Date, pageSize?: number, max?: number, caller?: string, callee?: string }} opts
 */
export async function fetchCdr(client, { from, to, pageSize = 1000, max = 50_000, caller, callee }) {
  const out = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const res = await client.call('cdrapi', {
      format: 'json',
      startTime: ucmTime(from),
      endTime: ucmTime(to),
      numRecords: String(pageSize),
      offset: String(offset),
      ...(caller ? { caller } : {}),
      ...(callee ? { callee } : {}),
    });
    const rows = flattenCdr(res);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Accept the several shapes the UCM uses and return one normalised call per record. */
export function flattenCdr(res) {
  const root = res?.cdr_root ?? res?.cdr ?? (Array.isArray(res) ? res : []);
  return root.map((r) => normaliseCall(r.main_cdr ?? r)).filter(Boolean);
}

export function normaliseCall(r) {
  if (!r || (!r.src && !r.dst)) return null;
  const disposition = String(r.disposition ?? '').toUpperCase();
  return {
    id: r.AcctId ?? r.uniqueid ?? r.session ?? `${r.start}-${r.src}-${r.dst}`,
    start: r.start ?? null,
    answered: disposition === 'ANSWERED',
    disposition: disposition || null,
    from: String(r.src ?? ''),
    to: String(r.dst ?? ''),
    callerName: parseClidName(r.clid),
    durationSec: Number(r.duration ?? 0),
    talkSec: Number(r.billsec ?? 0),
    direction: null,
  };
}

function parseClidName(clid) {
  const m = String(clid ?? '').match(/^"?([^"<]*)"?\s*</);
  return m ? m[1].trim() || null : null;
}

/**
 * Build a report.
 * @param {Array} calls normalised calls
 * @param {{ extensions?: Array, sites?: Array }} dir  who owns each number
 *   extensions: normalised accounts (number -> display name)
 *   sites: [{ id, name, extension }] to group numbers into sites
 */
export function tallyCalls(calls, { extensions = [], sites = [] } = {}) {
  const nameOf = new Map(extensions.map((e) => [e.extension, e.name]));
  const siteOf = new Map();
  for (const s of sites) for (const e of String(s.extension ?? '').split(/[/,\s]+/).filter(Boolean)) siteOf.set(e, s.name);
  const internal = (n) => nameOf.has(n) || siteOf.has(n);
  const label = (n) => siteOf.get(n) ?? nameOf.get(n) ?? null;

  const bySite = new Map();
  const pairs = new Map();
  const byHour = Array(24).fill(0);
  const totals = { calls: 0, answered: 0, missed: 0, busy: 0, failed: 0, internal: 0, inbound: 0, outbound: 0, talkSec: 0 };

  const bucket = (n) => {
    const key = label(n) ?? n;
    if (!bySite.has(key)) bySite.set(key, { name: key, extensions: new Set(), made: 0, received: 0, answered: 0, missed: 0, talkSec: 0, topPartners: new Map() });
    const b = bySite.get(key);
    b.extensions.add(n);
    return b;
  };

  for (const c of calls) {
    const fromIn = internal(c.from);
    const toIn = internal(c.to);
    c.direction = fromIn && toIn ? 'internal' : fromIn ? 'outbound' : toIn ? 'inbound' : 'external';
    totals.calls += 1;
    totals[c.direction] = (totals[c.direction] ?? 0) + 1;
    totals.talkSec += c.talkSec;
    if (c.answered) totals.answered += 1;
    else if (c.disposition === 'BUSY') totals.busy += 1;
    else if (c.disposition === 'FAILED') totals.failed += 1;
    else totals.missed += 1;

    const hour = c.start ? Number(String(c.start).slice(11, 13)) : NaN;
    if (!Number.isNaN(hour)) byHour[hour] += 1;

    const partner = (n) => label(n) ?? n;
    if (fromIn) {
      const b = bucket(c.from);
      b.made += 1;
      b.talkSec += c.talkSec;
      b.topPartners.set(partner(c.to), (b.topPartners.get(partner(c.to)) ?? 0) + 1);
    }
    if (toIn) {
      const b = bucket(c.to);
      b.received += 1;
      if (c.answered) b.answered += 1; else b.missed += 1;
      if (!fromIn) b.talkSec += c.talkSec;
      b.topPartners.set(partner(c.from), (b.topPartners.get(partner(c.from)) ?? 0) + 1);
    }
    if (fromIn || toIn) {
      const key = `${partner(c.from)} → ${partner(c.to)}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }

  const sitesOut = [...bySite.values()]
    .map((b) => ({
      name: b.name,
      extensions: [...b.extensions],
      made: b.made,
      received: b.received,
      answered: b.answered,
      missed: b.missed,
      answerRate: b.received ? Number((b.answered / b.received).toFixed(2)) : null,
      talkMinutes: Math.round(b.talkSec / 60),
      topPartners: [...b.topPartners].sort((a, z) => z[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    }))
    .sort((a, z) => z.made + z.received - (a.made + a.received));

  return {
    totals: { ...totals, talkMinutes: Math.round(totals.talkSec / 60) },
    sites: sitesOut,
    topRoutes: [...pairs].sort((a, z) => z[1] - a[1]).slice(0, 20).map(([route, count]) => ({ route, count })),
    byHour,
    quiet: sites.filter((s) => !bySite.has(s.name) && s.extension).map((s) => s.name),
  };
}

/** Report as CSV rows (one per site). */
export function reportToCsv(report) {
  const head = ['site', 'extensions', 'made', 'received', 'answered', 'missed', 'answer_rate', 'talk_minutes', 'top_partner'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = report.sites.map((s) => [s.name, s.extensions.join(' '), s.made, s.received, s.answered, s.missed, s.answerRate ?? '', s.talkMinutes, s.topPartners[0]?.name ?? ''].map(q).join(','));
  return [head.join(','), ...rows].join('\n');
}
