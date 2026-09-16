import { ACTIONS, READ_AUDIT_ACTIONS } from './actions.js';
import { STATUS_TEXT } from './client.js';

/**
 * Call every read-only action and report what this API user can see.
 * Returns { platform, results: [{ action, status, count, error, data }] }.
 */
export async function runAudit(client, { actions = READ_AUDIT_ACTIONS, includeData = true } = {}) {
  const results = [];
  for (const action of actions) {
    try {
      const data = ACTIONS[action]?.listKey ? await client.list(action) : await client.call(action);
      results.push({ action, status: 0, count: Array.isArray(data) ? data.length : null, data: includeData ? data : undefined });
    } catch (e) {
      results.push({ action, status: e.status ?? null, error: e.status != null ? STATUS_TEXT[e.status] ?? e.message : e.message });
    }
  }
  const info = results.find((r) => r.action === 'getSystemGeneralStatus')?.data;
  return {
    at: new Date().toISOString(),
    platform: info ? { model: info['product-model'], firmware: info['prog-version'] } : null,
    results,
    missingPermissions: results.filter((r) => r.status === -47).map((r) => r.action),
  };
}
