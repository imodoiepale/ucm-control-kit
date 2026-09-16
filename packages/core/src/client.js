import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { ACTIONS, isWriteAction } from './actions.js';

/** Status codes the UCM returns that mean "your cookie is no longer valid". */
const SESSION_EXPIRED = new Set([-6, -8]);

export class UcmError extends Error {
  constructor(action, status, response) {
    super(`${action} failed with UCM status ${status}${STATUS_TEXT[status] ? ` (${STATUS_TEXT[status]})` : ''}`);
    this.name = 'UcmError';
    this.action = action;
    this.status = status;
    this.response = response;
  }
}

export const STATUS_TEXT = {
  [-6]: 'session expired',
  [-8]: 'session timeout',
  [-37]: 'wrong username or password',
  [-47]: 'no permission for this action',
  [-68]: 'login restricted',
};

/**
 * Client for the Grandstream UCM "new" HTTPS API (POST /api, JSON).
 *
 * - Challenge/MD5 login, cookie cached, one automatic re-login when the session expires.
 * - Requests are serialised: the UCM handles one session poorly under concurrency.
 * - Write actions are refused unless listed in `allowWrites`; `dryRun` records them without sending.
 */
export class UcmClient {
  /**
   * @param {object} opts
   * @param {string} opts.host        e.g. "192.168.0.10:8089" or "https://pbx.example.com:8089"
   * @param {string} opts.user
   * @param {string} opts.password
   * @param {string[]} [opts.allowWrites]  write actions this client may send
   * @param {boolean} [opts.dryRun]
   * @param {boolean} [opts.insecure]    accept the UCM's self-signed certificate (default true)
   * @param {number} [opts.timeoutMs]
   * @param {(entry: object) => void} [opts.onAudit]  called for every request
   */
  constructor({ host, user, password, allowWrites = [], dryRun = false, insecure = true, timeoutMs = 10_000, onAudit } = {}) {
    if (!host || !user || !password) throw new Error('UcmClient needs host, user and password');
    this.url = new URL(host.includes('://') ? host : `https://${host}`);
    this.url.pathname = '/api';
    this.user = user;
    this.password = password;
    this.allowWrites = new Set(allowWrites);
    this.dryRun = dryRun;
    this.timeoutMs = timeoutMs;
    this.onAudit = onAudit ?? (() => {});
    this.agent = this.url.protocol === 'https:' ? new Agent({ rejectUnauthorized: !insecure, keepAlive: true }) : undefined;
    this.cookie = null;
    this.queue = Promise.resolve();
  }

  /** Low-level POST without session handling. */
  post(body) {
    const payload = JSON.stringify({ request: body });
    const send = this.url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(this.url, {
        method: 'POST',
        agent: this.agent,
        headers: { 'content-type': 'application/json;charset=UTF-8', 'content-length': Buffer.byteLength(payload) },
        timeout: this.timeoutMs,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`UCM returned non-JSON (HTTP ${res.statusCode})`)); }
        });
      });
      req.on('timeout', () => req.destroy(new Error(`UCM request timed out after ${this.timeoutMs}ms`)));
      req.on('error', reject);
      req.end(payload);
    });
  }

  async login() {
    const ch = await this.post({ action: 'challenge', user: this.user, version: '1.0' });
    if (ch.status !== 0) throw new UcmError('challenge', ch.status, ch.response);
    const token = createHash('md5').update(ch.response.challenge + this.password).digest('hex');
    const res = await this.post({ action: 'login', user: this.user, token });
    this.onAudit({ at: new Date().toISOString(), action: 'login', status: res.status });
    if (res.status !== 0) throw new UcmError('login', res.status, res.response);
    this.cookie = res.response.cookie;
    return this.cookie;
  }

  async logout() {
    if (!this.cookie) return;
    const cookie = this.cookie;
    this.cookie = null;
    await this.post({ action: 'logout', cookie }).catch(() => {});
  }

  /**
   * Call any API action. Returns `response` on status 0, throws UcmError otherwise.
   * @param {string} action
   * @param {object} [params]
   */
  call(action, params = {}) {
    const run = () => this.#call(action, params);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async #call(action, params) {
    const write = isWriteAction(action);
    if (write && !this.allowWrites.has(action)) {
      throw new Error(`Write action "${action}" is not in allowWrites; refusing to send it`);
    }
    if (write && this.dryRun) {
      this.onAudit({ at: new Date().toISOString(), action, params, dryRun: true });
      return { dryRun: true, action, params };
    }
    if (!this.cookie) await this.login();
    let res = await this.post({ action, cookie: this.cookie, ...params });
    if (SESSION_EXPIRED.has(res.status)) {
      await this.login();
      res = await this.post({ action, cookie: this.cookie, ...params });
    }
    this.onAudit({ at: new Date().toISOString(), action, params: write ? params : undefined, status: res.status, write });
    // cdrapi on firmware 1.0.33.30 answers with the records at the top level
    // and no status field at all. Anything else without a status is an error.
    if (res.status === undefined && action === 'cdrapi' && !res.response) return res;
    if (res.status !== 0) throw new UcmError(action, res.status, res.response ?? res);
    return res.response;
  }

  /**
   * Fetch every page of a list action and return the concatenated rows.
   * @param {string} action e.g. "listAccount"
   * @param {object} [params]
   */
  async list(action, params = {}) {
    const key = ACTIONS[action]?.listKey;
    const rows = [];
    let page = 1;
    for (;;) {
      const res = await this.call(action, { ...params, page, item_num: params.item_num ?? 100 });
      const arr = key ? res[key] : Object.values(res).find(Array.isArray);
      rows.push(...(arr ?? []));
      const pages = Number(res.total_page ?? 1);
      if (page >= pages || !arr?.length) break;
      page += 1;
    }
    return rows;
  }

  // Convenience wrappers for the actions the kit relies on.
  systemStatus() { return this.call('getSystemStatus'); }
  systemInfo() { return this.call('getSystemGeneralStatus'); }
  extensions() { return this.list('listAccount').then((rows) => rows.map(normaliseAccount)); }
  sipAccount(extension) {
    return this.call('getSIPAccount', { extension: String(extension) }).then((res) => stripSecrets(res?.extension ?? res));
  }
  bridgedChannels() { return this.list('listBridgedChannels'); }
  unbridgedChannels() { return this.list('listUnBridgedChannels'); }
  dialExtension(caller, callee) { return this.call('dialExtension', { caller: String(caller), callee: String(callee) }); }
  hangup(channel) { return this.call('Hangup', { channel }); }
}

/**
 * getSIPAccount returns the SIP and voicemail passwords in clear text
 * (verified on UCM6304 1.0.33.30). They never leave the client.
 */
export const SECRET_FIELDS = ['secret', 'vmsecret', 'user_outrt_passwd', 'authid_password'];
export function stripSecrets(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const k of SECRET_FIELDS) if (k in out) out[k] = out[k] ? '(set)' : '';
  return out;
}

/** Turn a raw listAccount row into a stable shape. */
export function normaliseAccount(row) {
  const addr = row.addr && row.addr !== '-' ? row.addr : null;
  const m = addr?.match(/^([\d.]+):(\d+)(?:\s*\(([^)]+)\))?/);
  return {
    extension: String(row.extension),
    name: row.fullname ?? '',
    type: row.account_type ?? null,
    registered: row.status !== 'Unavailable',
    status: row.status ?? null,
    ip: m?.[1] ?? null,
    port: m ? Number(m[2]) : null,
    model: m?.[3] ?? null,
    outOfService: row.out_of_service === 'yes',
    department: row.department_name ?? null,
    presence: row.presence_status ?? null,
  };
}
