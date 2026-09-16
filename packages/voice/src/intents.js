/**
 * Offline intent parser for spoken commands. It maps a transcript to one kit tool call,
 * so voice works in any browser with no AI provider. Hosts with an LLM voice agent
 * (ElevenLabs, OpenAI Realtime, Gemini Live) should use exportTools() instead.
 */

const YES = /^(yes|yeah|yep|confirm|confirmed|go ahead|do it|sure|okay|ok)\b/i;
const NO = /^(no|nope|cancel|stop|don't|do not)\b/i;

export function parseIntent(text) {
  const t = String(text ?? '').trim().replace(/[.?!]+$/, '');
  if (!t) return null;
  if (YES.test(t)) return { kind: 'confirm' };
  if (NO.test(t)) return { kind: 'cancel' };

  let m = t.match(/(?:test|place a test|make a test)?\s*call\s+(?:from\s+)?(.+?)\s+to\s+(.+)$/i);
  if (m) return { kind: 'tool', tool: 'test_call', args: { from: clean(m[1]), to: clean(m[2]) } };

  if (/(which|what|list|show).*(offline|down|not working|unregistered)/i.test(t)) return { kind: 'tool', tool: 'list_extensions', args: { offline_only: true } };
  if (/(out of date|outdated|wrong|reconcile|check).*(extension|number)|(extension|number)s?.*(out of date|outdated|wrong)/i.test(t)) return { kind: 'tool', tool: 'reconcile_sites', args: {} };
  m = t.match(/(?:rename|change the name of)\s+(?:extension\s+)?(.+?)\s+to\s+(.+)$/i);
  if (m) return { kind: 'tool', tool: 'update_extension', args: { extension: clean(m[1]), changes: { fullname: m[2].trim() } } };
  if (/(call|calls)\s+(report|summary|count)|how many calls/i.test(t)) {
    const period = /yesterday/i.test(t) ? 'yesterday' : /week/i.test(t) ? 'week' : /month/i.test(t) ? 'month' : 'today';
    const site = t.match(/(?:at|for|from)\s+(?!this|today|yesterday|the last)(.+?)(?:\s+(?:today|yesterday|this week|this month))?$/i)?.[1];
    return { kind: 'tool', tool: 'call_report', args: site && !/each|every|all/i.test(site) ? { period, site: clean(site) } : { period } };
  }
  if (/(who|anyone|any).*(call|talking)|active calls/i.test(t)) return { kind: 'tool', tool: 'active_calls', args: {} };
  if (/(anything|what).*(change|happen)/i.test(t)) return { kind: 'tool', tool: 'watch_changes', args: {} };

  m = t.match(/(?:status|phone|phones|extension)\s+(?:status\s+)?(?:at|for|of|in)\s+(.+)$/i)
    ?? t.match(/is\s+(?:extension\s+)?(.+?)\s+(?:working|online|up|registered)$/i)
    ?? t.match(/(?:check|diagnose)\s+(?:extension\s+)?(.+)$/i);
  if (m) return { kind: 'tool', tool: 'extension_status', args: { extension: clean(m[1]) } };

  if (/(pbx|phone system|phones|system).*(health|status|ok|okay|up)|how are the phones/i.test(t)) return { kind: 'tool', tool: 'pbx_status', args: {} };
  if (/list.*extensions|all extensions/i.test(t)) return { kind: 'tool', tool: 'list_extensions', args: {} };
  return null;
}

const clean = (s) => s.replace(/^(the|extension)\s+/i, '').replace(/\s+(branch|extension|please)$/i, '').trim();

/** Short spoken reply for a tool result. */
export function speak(tool, r) {
  if (r?.needsConfirmation) return null;
  switch (tool) {
    case 'pbx_status':
      return r.pbxUp
        ? `The phone system is up. ${r.online} of ${r.extensions} phones are registered, ${r.offline} offline, ${r.activeCalls} calls in progress.${r.trunksDown ? ` ${r.trunksDown} trunks are down.` : ''}`
        : 'I cannot reach the phone system.';
    case 'list_extensions':
      if (!r.count) return 'No phones match.';
      return `${r.count} ${r.count === 1 ? 'phone' : 'phones'}: ${r.extensions.slice(0, 8).map((e) => e.name || e.extension).join(', ')}${r.count > 8 ? `, and ${r.count - 8} more` : ''}.`;
    case 'extension_status':
      return `${r.account.name}, extension ${r.account.extension}. ${r.diagnosis.summary}`;
    case 'active_calls':
      return r.active || r.ringing ? `${r.active} calls in progress and ${r.ringing} ringing.` : 'Nobody is on a call right now.';
    case 'reconcile_sites': {
      const s = r.summary;
      const bad = (s.changed ?? 0) + (s.found ?? 0) + (s.conflict ?? 0) + (s.ambiguous ?? 0) + (s.missing ?? 0);
      return bad ? `${bad} sites need attention: ${s.changed ?? 0} have the wrong number, ${s.conflict ?? 0} conflict, ${s.ambiguous ?? 0} are ambiguous. The details are on screen.` : 'Every site has the right extension.';
    }
    case 'test_call':
      return r.message;
    case 'call_report': {
      const top = r.sites.slice(0, 3).map((s) => `${s.name} ${s.made + s.received}`).join(', ');
      return `${r.totals.calls} calls, ${r.totals.answered} answered, ${r.totals.missed} missed, ${r.totals.talkMinutes} minutes of talk time.${top ? ` Busiest: ${top}.` : ''}${r.quiet?.length ? ` ${r.quiet.length} ${r.quiet.length === 1 ? "site" : "sites"} had no calls.` : ''}`;
    }
    case 'update_extension':
      if (r.preview) {
        if (!r.ok) return `I can't make that change: ${r.errors.join('; ')}.`;
        if (r.noChange) return 'That is already set.';
        return `This will change ${r.diff.map((d) => `${d.label} from ${d.from || 'blank'} to ${d.to}`).join(', ')} on extension ${r.extension}. Say yes to apply.`;
      }
      return r.message;
    case 'watch_changes':
      return r.events.length ? `${r.events.length} changes: ${r.events.slice(0, 5).map((e) => `${e.name ?? e.extension ?? 'PBX'} ${e.type.split('.')[1]}`).join(', ')}.` : r.note ?? 'Nothing has changed.';
    default:
      return 'Done.';
  }
}
