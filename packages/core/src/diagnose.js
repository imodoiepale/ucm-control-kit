/**
 * Decide the smallest fix for a site whose phone is not working.
 *
 * Inputs are facts the caller has already gathered, so this stays pure and testable:
 *   site        { name, extension }
 *   account     normalised live account or null
 *   known       last known-good account/SIP settings (snapshot) or null
 *   network     { reachable: boolean } from the caller's own probe, or null if unknown
 *
 * Returns { cause, summary, steps: [{ action, params, write, why }] }. Nothing is sent.
 */
export function diagnose({ site, account, known = null, network = null, liveSettings = null }) {
  const ext = String(site.extension ?? '').split(/[/,\s]+/)[0] || null;

  // A registered phone proves the site's line works, whatever the PC probe says.
  if (network && network.reachable === false && !account?.registered) {
    return plan('network', `${site.name} is unreachable on the network. Fix connectivity first; the PBX is not changed.`, [
      { action: 'check-network', why: 'site router, internet or VPN is down', write: false },
    ]);
  }
  if (!ext) {
    return plan('no-extension', `${site.name} has no extension recorded.`, [
      { action: 'assign-extension', why: 'pick the next free number from the numbering plan', write: false },
    ]);
  }
  if (!account) {
    if (known) {
      return plan('extension-missing', `Extension ${ext} no longer exists on the PBX. It can be recreated from the last known-good record.`, [
        { action: 'addSIPAccount', params: restorable(known), write: true, why: 'recreate from snapshot' },
      ]);
    }
    return plan('extension-missing', `Extension ${ext} does not exist on the PBX and there is no saved copy.`, [
      { action: 'addSIPAccount', params: { extension: ext, fullname: site.name }, write: true, why: 'create from template; set a new secret and re-provision the phone' },
    ]);
  }
  if (account.outOfService) {
    return plan('out-of-service', `Extension ${ext} is marked out of service.`, [
      { action: 'updateSIPAccount', params: { extension: ext, out_of_service: 'no' }, write: true, why: 'bring the extension back into service' },
    ]);
  }
  const drift = known && liveSettings ? settingsDrift(known, liveSettings) : [];
  if (drift.length) {
    return plan('drift', `Extension ${ext} changed since it last worked: ${drift.map((d) => d.field).join(', ')}.`, [
      { action: 'updateSIPAccount', params: { extension: ext, ...Object.fromEntries(drift.map((d) => [d.field, d.known])) }, write: true, why: 'restore only the changed fields' },
    ], drift);
  }
  if (!account.registered) {
    const lastSeen = known?.ip ? ` It last registered from ${known.ip}${known.model ? ` (${known.model})` : ''}.` : '';
    return plan('phone-side', `Extension ${ext} is configured correctly but no phone is registered.${lastSeen}`, [
      { action: 'check-phone', why: 'power, cable and network light on the phone', write: false, target: known?.ip ?? null },
      { action: 'reprovision-phone', why: 'send the site the recovery link or push zero-config', write: false },
      { action: 'dialExtension', write: true, why: 'test call once the phone shows registered' },
    ]);
  }
  return plan('healthy', `Extension ${ext} is registered${account.ip ? ` from ${account.ip}` : ''}. Run a test call to confirm audio.`, [
    { action: 'dialExtension', write: true, why: 'confirm two-way audio' },
  ]);
}

const plan = (cause, summary, steps, drift = []) => ({ cause, summary, steps, drift });

const IGNORE = new Set(['status', 'addr', 'ip', 'port', 'registered', 'presence', 'newmsg', 'oldmsg', 'urgemsg', 'model']);

/** Fields whose value changed, never proposing to blank a value. */
export function settingsDrift(known, live) {
  const out = [];
  for (const [field, value] of Object.entries(known)) {
    if (IGNORE.has(field) || value === '' || value == null) continue;
    if (String(live[field] ?? '') !== String(value)) out.push({ field, known: value, live: live[field] ?? null });
  }
  return out;
}

function restorable(known) {
  return Object.fromEntries(Object.entries(known).filter(([k, v]) => !IGNORE.has(k) && v !== '' && v != null));
}
