/**
 * Compare an organisation's site registry with the extensions on the UCM.
 *
 * A site is `{ id, name, aliases?, extension?, subnet? }`. `extension` may be "1001" or "1001/1002".
 * An account is the output of `normaliseAccount`.
 *
 * Nothing is changed here; the result is a list of findings a human (or an allow-listed
 * automation) can act on.
 */

const STOP = new Set(['the', 'centre', 'center', 'shop', 'branch']);
/** Common short forms in PBX display names. Extend per organisation with `reconcile(..., { abbreviations })`. */
export const DEFAULT_ABBREVIATIONS = { ksm: 'kisumu', msa: 'mombasa', nbi: 'nairobi', perf: 'perfume', acc: 'accounts', ho: 'head office', rd: 'road', st: 'street', ave: 'avenue' };
export function normaliseName(s, abbrev = DEFAULT_ABBREVIATIONS) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => abbrev[w] ?? w)
    .join(' ')
    .trim();
}

const compact = (s, ab) => normaliseName(s, ab).replace(/\s+/g, '');
const tokens = (s, ab) => new Set(normaliseName(s, ab).split(' ').filter((w) => w && !STOP.has(w)));

/** 0..1 similarity between a site name/alias and an account display name. */
export function nameScore(siteName, accountName, abbrev = DEFAULT_ABBREVIATIONS) {
  const a = compact(siteName, abbrev);
  const b = compact(accountName, abbrev);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = tokens(siteName, abbrev);
  const tb = tokens(accountName, abbrev);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of tb) {
    if (ta.has(w) || [...ta].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) shared += 1;
  }
  // Every account word must be explained by the site name; a bonus when all site words are too.
  const coverage = shared / tb.size;
  // Site name fully contained in a longer account name, e.g. "Hill" vs "Hill Annex".
  if (coverage < 1) return shared === ta.size ? 0.75 : coverage * 0.5;
  return shared >= ta.size ? 0.9 : 0.75;
}

export function inSubnet(ip, subnet) {
  if (!ip || !subnet) return false;
  const [base, bits = '24'] = subnet.split('/');
  const n = Number(bits);
  const toInt = (x) => x.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

const splitExt = (e) => String(e ?? '').split(/[/,\s]+/).filter(Boolean);

/**
 * @param {Array} sites
 * @param {Array} accounts normalised accounts
 * @param {{ minScore?: number, abbreviations?: Record<string, string> }} [opts]
 * @returns {{ sites: Array, unassigned: Array, summary: object }}
 */
export function reconcile(sites, accounts, { minScore = 0.75, abbreviations = {} } = {}) {
  const ab = { ...DEFAULT_ABBREVIATIONS, ...abbreviations };
  const score = (name, acc) => nameScore(name, acc.name, ab);
  const byExt = new Map(accounts.map((a) => [a.extension, a]));
  const claimed = new Set();

  const bestMatch = (site) => {
    const names = [site.name, ...(site.aliases ?? [])];
    let best = null;
    for (const acc of accounts) {
      let s = Math.max(...names.map((n) => score(n, acc)));
      const ipOk = site.subnet ? inSubnet(acc.ip, site.subnet) : null;
      if (ipOk === true) s = Math.min(1, s + 0.1);
      if (ipOk === false && acc.ip) s -= 0.15;
      if (!best || s > best.score) best = { account: acc, score: s, ipOk };
    }
    return best && best.score >= minScore ? best : null;
  };

  const results = sites.map((site) => {
    const current = splitExt(site.extension);
    const currentAccounts = current.map((e) => byExt.get(e)).filter(Boolean);
    const match = bestMatch(site);
    const base = { siteId: site.id, site: site.name, current };

    // The registered number really belongs to this site.
    const confirmed = currentAccounts.find((a) => Math.max(...[site.name, ...(site.aliases ?? [])].map((n) => score(n, a))) >= minScore);
    if (confirmed) {
      claimed.add(confirmed.extension);
      return { ...base, kind: 'ok', extension: confirmed.extension, account: confirmed };
    }
    if (match) {
      claimed.add(match.account.extension);
      return {
        ...base,
        kind: current.length ? 'changed' : 'found',
        proposed: match.account.extension,
        account: match.account,
        confidence: Number(match.score.toFixed(2)),
        evidence: [`UCM name "${match.account.name}"`, match.ipOk ? `registers from ${match.account.ip} inside ${site.subnet}` : null].filter(Boolean),
      };
    }
    if (currentAccounts.length) {
      return {
        ...base,
        kind: 'conflict',
        account: currentAccounts[0],
        evidence: [`${currentAccounts[0].extension} is named "${currentAccounts[0].name}" on the UCM`],
      };
    }
    return { ...base, kind: current.length ? 'missing' : 'none' };
  });

  // One account can belong to one site. When several sites want the same account,
  // the clearly best score keeps it; a tie turns all of them into "ambiguous".
  const wanted = new Map();
  for (const r of results) {
    if (r.proposed) wanted.set(r.proposed, [...(wanted.get(r.proposed) ?? []), r]);
  }
  const okExts = new Set(results.filter((r) => r.kind === 'ok').map((r) => r.extension));
  for (const [ext, rivals] of wanted) {
    const top = Math.max(...rivals.map((r) => r.confidence));
    const winners = okExts.has(ext) ? [] : rivals.filter((r) => r.confidence === top);
    for (const r of rivals) {
      if (winners.length === 1 && r === winners[0]) continue;
      r.kind = 'ambiguous';
      const others = [...rivals.filter((x) => x !== r).map((x) => x.site), ...(okExts.has(ext) ? ['a confirmed site'] : [])];
      r.evidence = [...r.evidence, `extension ${ext} is also matched by ${others.join(', ')}`];
    }
    if (winners.length !== 1) claimed.delete(ext);
    if (okExts.has(ext)) claimed.add(ext);
  }

  const unassigned = accounts.filter((a) => !claimed.has(a.extension));
  const summary = {};
  for (const r of results) summary[r.kind] = (summary[r.kind] ?? 0) + 1;
  summary.unassigned = unassigned.length;
  return { sites: results, unassigned, summary };
}
