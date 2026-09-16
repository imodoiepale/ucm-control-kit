import { UcmClient } from './client.js';

export { ACTIONS, isWriteAction, READ_AUDIT_ACTIONS, TESTED_PLATFORM } from './actions.js';
export { runAudit } from './audit.js';
export { normaliseAccount, SECRET_FIELDS, STATUS_TEXT, stripSecrets, UcmClient, UcmError } from './client.js';
export { diagnose, settingsDrift } from './diagnose.js';
export { AlertEngine, diffSnapshots, parseUptime, summarise, takeSnapshot } from './monitor.js';
export { inSubnet, nameScore, normaliseName, reconcile } from './reconcile.js';
export { testCall } from './testcall.js';

/** Build a client from UCM_HOST / UCM_USER / UCM_PASSWORD (and optional UCM_ALLOW_WRITES, UCM_DRY_RUN). */
export function clientFromEnv(env = process.env, extra = {}) {
  return new UcmClient({
    host: env.UCM_HOST,
    user: env.UCM_USER,
    password: env.UCM_PASSWORD,
    allowWrites: (env.UCM_ALLOW_WRITES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    dryRun: env.UCM_DRY_RUN === '1' || env.UCM_DRY_RUN === 'true',
    ...extra,
  });
}
export { fetchCdr, flattenCdr, reportToCsv, tallyCalls, ucmTime } from './cdr.js';
export { applyExtensionEdit, EDITABLE_FIELDS, planExtensionEdit, readExtension, validateChanges } from './edit.js';
export { exportTools, resolveExtension, runTool, TOOLS } from './tools.js';
