import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * Minimal in-memory UCM for tests and demos. Speaks the same JSON as the real /api.
 * State is mutable so tests can take phones offline, expire sessions, and so on.
 */
export function sampleState() {
  return {
    user: 'api', password: 'secret',
    denied: new Set(['listRingGroup']),
    system: {
      status: { 'up-time': '2 03:04:05', 'system-time': '2026-01-01 00:00:00 UTC+00:00' },
      general: { 'product-model': 'UCM6304  V1.6A', 'prog-version': '1.0.33.30' },
    },
    accounts: [
      acc('1001', 'Harbour Road', 'Idle', '10.10.1.20:5060 (GXP1615)'),
      acc('1002', 'Hill Street', 'Unavailable', '-'),
      acc('1003', 'Lake View Mall', 'Idle', '10.10.3.20:5060 (GXP1610)'),
      acc('1004', 'Reception', 'Idle', '10.0.0.5:5060 (GRP2601)'),
      acc('1005', 'KSM Central', 'Idle', '10.10.5.20:5060 (GXP1615)'),
    ],
    sip: {},
    cdr: [
      cdr('2026-01-05 09:15:00', '1001', '1003', 'ANSWERED', 120),
      cdr('2026-01-05 09:40:00', '1001', '1005', 'NO ANSWER', 0),
      cdr('2026-01-05 10:02:00', '1003', '1001', 'ANSWERED', 60),
      cdr('2026-01-05 10:30:00', '0700111222', '1003', 'ANSWERED', 300),
      cdr('2026-01-05 14:00:00', '1005', '0722333444', 'BUSY', 0),
    ],
    voipTrunks: [],
    bridged: [],
    unbridged: [],
    writes: [],
    sessions: new Set(),
    pageSize: 2,
  };
}

function cdr(start, src, dst, disposition, billsec) {
  return { main_cdr: { start, src, dst, disposition, billsec: String(billsec), duration: String(billsec + 10), clid: `"x" <${src}>`, AcctId: `${start}-${src}` } };
}

function acc(extension, fullname, status, addr) {
  return { extension, account_type: 'SIP(WebRTC)', fullname, status, addr, out_of_service: 'no', department_name: '' };
}

export async function startFakeUcm(state = sampleState()) {
  let challenge = '';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = JSON.parse(body).request;
      const send = (status, response = {}) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status, response })); };
      if (r.action === 'challenge') { challenge = String(Math.floor(Math.random() * 1e12)).padStart(16, '0'); return send(r.user === state.user ? 0 : -47, { challenge }); }
      if (r.action === 'login') {
        const ok = r.token === createHash('md5').update(challenge + state.password).digest('hex');
        if (!ok) return send(-37);
        const cookie = `sid${Math.random().toString(36).slice(2)}`;
        state.sessions.add(cookie);
        return send(0, { cookie });
      }
      if (!state.sessions.has(r.cookie)) return send(-6);
      if (state.denied.has(r.action)) return send(-47);
      const page = (rows, key) => {
        const size = Number(r.item_num ?? state.pageSize);
        const p = Number(r.page ?? 1);
        return send(0, { [key]: rows.slice((p - 1) * size, p * size), total_item: rows.length, total_page: Math.max(1, Math.ceil(rows.length / size)), page: p });
      };
      switch (r.action) {
        case 'logout': state.sessions.delete(r.cookie); return send(0);
        case 'getSystemStatus': return send(0, state.system.status);
        case 'getSystemGeneralStatus': return send(0, state.system.general);
        case 'listAccount': return page(state.accounts, 'account');
        case 'listVoIPTrunk': return page(state.voipTrunks, 'voip_trunk');
        case 'listAnalogTrunk': return page([], 'analogtrunk');
        case 'listBridgedChannels': return page(state.bridged, 'channel');
        case 'listUnBridgedChannels': return page(state.unbridged, 'channel');
        case 'getSIPAccount': {
          const a = state.accounts.find((x) => x.extension === r.extension);
          if (!a) return send(-25);
          return send(0, { extension: { extension: a.extension, fullname: a.fullname, cidnumber: '', permission: 'internal', out_of_service: a.out_of_service, secret: 'sip-secret', vmsecret: '1234', ...state.sip[r.extension] } });
        }
        case 'cdrapi': {
          const off = Number(r.offset ?? 0);
          // Like firmware 1.0.33.30: records at the top level, no status.
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ cdr_root: state.cdr.slice(off, off + Number(r.numRecords ?? 1000)) }));
        }
        case 'dialExtension':
        case 'updateSIPAccount':
        case 'addSIPAccount':
        case 'Hangup':
        case 'applyChanges':
          state.writes.push(r);
          if (r.action === 'updateSIPAccount') {
            const { action, cookie, extension, ...fields } = r;
            const a = state.accounts.find((x) => x.extension === extension);
            if (!a) return send(-25);
            if (fields.fullname) a.fullname = fields.fullname;
            state.sip[extension] = { ...state.sip[extension], ...fields };
          }
          if (r.action === 'addSIPAccount') {
            if (state.accounts.some((x) => x.extension === r.extension)) return send(-25);
            // A new phone that registers straight away, so tests can call it.
            state.accounts.push(acc(r.extension, r.fullname ?? '', 'Idle', '10.10.9.40:5060 (GXP1615)'));
          }
          if (r.action === 'dialExtension') state.bridged.push({ callerid1: r.caller, callerid2: r.callee, channel1: `PJSIP/${r.caller}-0001` });
          return send(0);
        default: return send(0, {});
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { state, host: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}
