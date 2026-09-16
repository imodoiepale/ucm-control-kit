/**
 * Admin editing of extension details with a preview.
 *
 * `planExtensionEdit` reads the current settings and returns only the fields that would change.
 * `applyExtensionEdit` sends that plan with updateSIPAccount (the client must allow-list it)
 * and reads the extension back to confirm the change stuck.
 */

/**
 * Fields getSIPAccount returns on UCM6304 1.0.33.30 that are safe to edit here.
 * Email and department are not in that response, so they are not offered.
 */
export const EDITABLE_FIELDS = {
  fullname: 'Display name (caller ID name)',
  cidnumber: 'Caller ID number',
  out_of_service: 'Out of service (yes/no)',
  permission: 'Call permission (internal, local, national, international)',
  enable_qualify: 'Keep-alive (yes/no)',
  nat: 'NAT (yes/no)',
  dnd: 'Do not disturb (yes/no)',
  call_waiting: 'Call waiting (yes/no)',
  ring_timeout: 'Ring timeout (seconds)',
};

const YES_NO = new Set(['out_of_service', 'enable_qualify', 'nat', 'dnd', 'call_waiting']);
const PERMISSIONS = new Set(['internal', 'internal-local', 'internal-local-national', 'internal-local-national-international']);

export function validateChanges(changes) {
  const errors = [];
  for (const [k, v] of Object.entries(changes)) {
    if (!(k in EDITABLE_FIELDS)) errors.push(`${k} cannot be edited here`);
    else if (v === '' || v == null) errors.push(`${k} cannot be blank`);
    else if (YES_NO.has(k) && !['yes', 'no'].includes(String(v))) errors.push(`${k} must be yes or no`);
    else if (k === 'permission' && !PERMISSIONS.has(String(v))) errors.push(`permission must be one of ${[...PERMISSIONS].join(', ')}`);
    else if (k === 'ring_timeout' && !(Number.isInteger(Number(v)) && Number(v) >= 5 && Number(v) <= 600)) errors.push('ring_timeout must be 5-600 seconds');
    else if (k === 'cidnumber' && !/^\+?\d{2,20}$/.test(String(v))) errors.push('cidnumber must be digits');
    else if (k === 'fullname' && String(v).length > 64) errors.push('fullname is longer than 64 characters');
  }
  return errors;
}

/** Current settings, secrets already masked by the client. */
export async function readExtension(client, extension) {
  return client.sipAccount(extension);
}

export async function planExtensionEdit(client, extension, changes) {
  const errors = validateChanges(changes);
  if (errors.length) return { ok: false, errors };
  const current = await readExtension(client, extension);
  if (!current) return { ok: false, errors: [`extension ${extension} not found`] };
  const diff = Object.entries(changes)
    .filter(([k, v]) => String(current[k] ?? '') !== String(v))
    .map(([field, to]) => ({ field, label: EDITABLE_FIELDS[field], from: current[field] ?? null, to: String(to) }));
  return { ok: true, extension: String(extension), diff, noChange: diff.length === 0 };
}

export async function applyExtensionEdit(client, plan, { actor = 'unknown' } = {}) {
  if (!plan?.ok) throw new Error('Cannot apply an invalid plan');
  if (plan.noChange) return { applied: false, message: 'Nothing to change' };
  const params = { extension: plan.extension, ...Object.fromEntries(plan.diff.map((d) => [d.field, d.to])) };
  const res = await client.call('updateSIPAccount', params);
  if (res?.dryRun) return { applied: false, dryRun: true, params };
  if (client.allowWrites.has('applyChanges')) await client.call('applyChanges');
  const after = await readExtension(client, plan.extension);
  const failed = plan.diff.filter((d) => String(after?.[d.field] ?? '') !== d.to);
  return {
    applied: failed.length === 0,
    actor,
    at: new Date().toISOString(),
    changed: plan.diff,
    notApplied: failed.map((d) => d.field),
    message: failed.length ? `The PBX did not keep: ${failed.map((d) => d.field).join(', ')}` : `Updated ${plan.diff.map((d) => d.field).join(', ')}`,
  };
}
