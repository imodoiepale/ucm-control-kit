import { fetchCdr, tallyCalls } from './cdr.js';
import { diagnose } from './diagnose.js';
import { applyExtensionEdit, EDITABLE_FIELDS, planExtensionEdit } from './edit.js';
import { diffSnapshots, summarise, takeSnapshot } from './monitor.js';
import { reconcile } from './reconcile.js';
import { testCall } from './testcall.js';

/**
 * One definition of every agent/voice tool. The MCP server, the voice schema exporters
 * and host apps all build on this list, so every surface behaves the same way.
 *
 * Tools with `write: true` refuse to run unless called with `confirm: true`, which an agent
 * should only set after a human said yes.
 */

const ext = { type: 'string', description: 'Extension number, e.g. "1001", or a site/display name' };
const confirm = { type: 'boolean', description: 'Must be true. Only set it after the user explicitly agreed to this action.' };

/** Resolve "Harbour Road" or "1059" to an account; refuses to guess when several match. */
export async function resolveExtension(client, query, { sites = [] } = {}) {
  const q = String(query ?? '').trim();
  const accounts = await client.extensions();
  const exact = accounts.find((a) => a.extension === q);
  if (exact) return exact;
  const site = sites.find((s) => [s.name, ...(s.aliases ?? [])].some((n) => n.toLowerCase() === q.toLowerCase()));
  if (site?.extension) {
    const byExt = accounts.find((a) => a.extension === String(site.extension).split(/[/,\s]+/)[0]);
    if (byExt) return byExt;
  }
  const lower = q.toLowerCase();
  const hits = accounts.filter((a) => a.name.toLowerCase() === lower);
  const partial = hits.length ? hits : accounts.filter((a) => a.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`No extension matches "${q}"`);
  throw new Error(`"${q}" matches ${partial.length} extensions: ${partial.slice(0, 6).map((a) => `${a.name} (${a.extension})`).join(', ')}. Say which one.`);
}

export const TOOLS = [
  {
    name: 'pbx_status',
    title: 'PBX health',
    description: 'Is the phone system healthy? Returns PBX up/down, firmware, registered vs offline extensions, trunk and active call counts.',
    input: { type: 'object', properties: {} },
    voice: ['is the PBX healthy', 'how are the phones'],
    run: async (client) => {
      const snap = await takeSnapshot(client);
      return { ...summarise(snap), model: snap.pbx.model, errors: snap.errors };
    },
  },
  {
    name: 'list_extensions',
    title: 'List extensions',
    description: 'List phone extensions with registration state, IP and phone model. Use offline_only to see phones that are down.',
    input: { type: 'object', properties: { offline_only: { type: 'boolean' }, search: { type: 'string', description: 'Filter by name or number' } } },
    voice: ['which phones are offline', 'list extensions'],
    run: async (client, { offline_only, search } = {}) => {
      let rows = await client.extensions();
      if (offline_only) rows = rows.filter((r) => !r.registered);
      if (search) rows = rows.filter((r) => `${r.extension} ${r.name}`.toLowerCase().includes(String(search).toLowerCase()));
      return { count: rows.length, extensions: rows.map(({ extension, name, registered, ip, model }) => ({ extension, name, registered, ip, model })) };
    },
  },
  {
    name: 'extension_status',
    title: 'Extension status',
    description: 'Status of one extension or site: registered or not, IP, model, and a diagnosis with the recommended fix.',
    input: { type: 'object', properties: { extension: ext }, required: ['extension'] },
    voice: ['what is the phone status at Harbour Road', 'is extension 1001 working'],
    run: async (client, { extension }, ctx = {}) => {
      const account = await resolveExtension(client, extension, ctx);
      const known = ctx.knownGood?.[account.extension] ?? null;
      return { account, diagnosis: diagnose({ site: { name: account.name, extension: account.extension }, account, known }) };
    },
  },
  {
    name: 'active_calls',
    title: 'Active calls',
    description: 'Calls in progress and calls still ringing.',
    input: { type: 'object', properties: {} },
    voice: ['who is on a call right now'],
    run: async (client) => {
      const [bridged, ringing] = await Promise.all([client.bridgedChannels(), client.unbridgedChannels()]);
      return { active: bridged.length, ringing: ringing.length, bridged, ringingChannels: ringing };
    },
  },
  {
    name: 'reconcile_sites',
    title: 'Check extension numbers',
    description: 'Compare the organisation site list with the PBX and report sites whose recorded extension is wrong, missing or ambiguous.',
    input: { type: 'object', properties: { only_problems: { type: 'boolean', default: true } } },
    voice: ['which branch extensions are out of date'],
    run: async (client, { only_problems = true } = {}, ctx = {}) => {
      if (!ctx.sites?.length) throw new Error('No site registry configured for this host');
      const r = reconcile(ctx.sites, await client.extensions());
      const sites = only_problems ? r.sites.filter((s) => s.kind !== 'ok') : r.sites;
      return {
        summary: r.summary,
        sites: sites.map(({ site, kind, current, proposed, confidence, evidence }) => ({ site, kind, current, proposed, confidence, evidence })),
        unassigned: r.unassigned.map(({ extension, name }) => ({ extension, name })),
      };
    },
  },
  {
    name: 'test_call',
    title: 'Test call',
    description: 'Ring one extension and connect it to another to prove the phones work. Both phones will ring. Requires confirm=true.',
    input: { type: 'object', properties: { from: ext, to: ext, confirm }, required: ['from', 'to', 'confirm'] },
    write: true,
    voice: ['test call from Harbour Road to Hill Street'],
    run: async (client, { from, to }, ctx = {}) => {
      const a = await resolveExtension(client, from, ctx);
      const b = await resolveExtension(client, to, ctx);
      return testCall(client, { from: a.extension, to: b.extension, timeoutMs: ctx.testCallTimeoutMs ?? 60_000 });
    },
  },
  {
    name: 'watch_changes',
    title: 'Changes since last check',
    description: 'What changed on the PBX since this tool was last called: phones going offline or online, removed extensions, reboots.',
    input: { type: 'object', properties: {} },
    voice: ['anything change on the phones'],
    run: async (client, _args, ctx = {}) => {
      const snap = await takeSnapshot(client);
      const prev = ctx.state?.lastSnapshot ?? null;
      if (ctx.state) ctx.state.lastSnapshot = snap;
      return prev ? { since: prev.at, events: diffSnapshots(prev, snap) } : { since: null, events: [], note: 'Baseline taken. Ask again later to see changes.' };
    },
  },
  {
    name: 'call_report',
    title: 'Call report',
    description: 'Calls made and received per site/person over a period: totals, answered vs missed, talk minutes, busiest routes and hours, and sites with no calls.',
    input: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'today, yesterday, week (last 7 days) or month (last 30 days). Default today.' },
        from: { type: 'string', description: 'Start, ISO date/time. Overrides period.' },
        to: { type: 'string', description: 'End, ISO date/time. Default now.' },
        site: { type: 'string', description: 'Only this site or extension' },
      },
    },
    voice: ['how many calls did each branch make today', 'call report for this week'],
    run: async (client, { period = 'today', from, to, site } = {}, ctx = {}) => {
      const range = periodRange(period, from, to);
      const [calls, extensions] = await Promise.all([fetchCdr(client, range), client.extensions()]);
      const report = tallyCalls(calls, { extensions, sites: ctx.sites ?? [] });
      const filtered = site
        ? { ...report, sites: report.sites.filter((s) => s.name.toLowerCase().includes(String(site).toLowerCase()) || s.extensions.includes(String(site))) }
        : report;
      return { from: range.from.toISOString(), to: range.to.toISOString(), ...filtered };
    },
  },
  {
    name: 'update_extension',
    title: 'Edit extension (admin)',
    description: `Change details of an extension. Editable fields: ${Object.keys(EDITABLE_FIELDS).join(', ')}. Call with confirm=false to preview the change, then confirm=true after the user approves. Admin only.`,
    input: {
      type: 'object',
      properties: {
        extension: ext,
        changes: { type: 'object', description: 'Field -> new value, e.g. {"fullname":"Harbour Road"}', additionalProperties: { type: 'string' } },
        confirm,
      },
      required: ['extension', 'changes', 'confirm'],
    },
    write: true,
    admin: true,
    preview: true,
    voice: ['rename extension 1004 to Front Desk'],
    run: async (client, { extension, changes, confirm: ok }, ctx = {}) => {
      if (ctx.isAdmin === false) throw new Error('Only IT admins can edit extensions');
      const account = await resolveExtension(client, extension, ctx);
      const plan = await planExtensionEdit(client, account.extension, changes ?? {});
      if (!ok || !plan.ok || plan.noChange) return { preview: true, account: { extension: account.extension, name: account.name }, ...plan };
      return applyExtensionEdit(client, plan, { actor: ctx.actor });
    },
  },
];

export function periodRange(period, from, to) {
  const end = to ? new Date(to) : new Date();
  if (from) return { from: new Date(from), to: end };
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  if (period === 'yesterday') {
    const y = new Date(start);
    y.setDate(y.getDate() - 1);
    return { from: y, to: start };
  }
  if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === 'month') start.setDate(start.getDate() - 29);
  else if (period !== 'today') throw new Error(`Unknown period "${period}"`);
  return { from: start, to: end };
}


/** Run a tool by name with the confirmation rule applied. */
export async function runTool(client, name, args = {}, ctx = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  if (tool.admin && ctx.isAdmin === false) throw new Error(`${tool.title} needs admin rights`);
  if (tool.preview && args.confirm !== true) return tool.run(client, { ...args, confirm: false }, ctx);
  if (tool.write && args.confirm !== true) {
    return { needsConfirmation: true, message: `${tool.title} changes the PBX or rings phones. Ask the user to confirm, then call again with confirm=true.` };
  }
  return tool.run(client, args, ctx);
}

/** Tool schemas in the shapes voice/LLM platforms expect. */
export function exportTools(format) {
  switch (format) {
    case 'openai': // Chat Completions / Responses / Realtime function tools
      return TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input }));
    case 'anthropic':
      return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input }));
    case 'gemini': // Gemini API / Live functionDeclarations
      return [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.input })) }];
    case 'elevenlabs': // Conversational AI client tools
      return TOOLS.map((t) => ({
        type: 'client',
        name: t.name,
        description: t.description,
        expects_response: true,
        parameters: t.input,
      }));
    default:
      throw new Error(`Unknown format ${format}; use openai, anthropic, gemini or elevenlabs`);
  }
}
