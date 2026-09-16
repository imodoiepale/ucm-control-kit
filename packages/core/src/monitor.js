/**
 * Turn successive UCM snapshots into state changes and alerts.
 *
 * `takeSnapshot(client)` reads what the kit can see. `diffSnapshots(prev, next)` returns
 * events such as `extension.offline`. `AlertEngine` applies grace periods and quiet hours.
 */

const safe = (p) => p.then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e.message, status: e.status }));

/** Parse the UCM "D HH:MM:SS" / "HH:MM:SS" uptime string into seconds. */
export function parseUptime(s) {
  const m = String(s ?? '').match(/^(?:(\d+)\s+)?(\d+):(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export async function takeSnapshot(client) {
  const [status, info, extensions, voip, analog, bridged, unbridged] = await Promise.all([
    safe(client.systemStatus()),
    safe(client.systemInfo()),
    safe(client.extensions()),
    safe(client.list('listVoIPTrunk')),
    safe(client.list('listAnalogTrunk')),
    safe(client.bridgedChannels()),
    safe(client.unbridgedChannels()),
  ]);
  const reachable = status.ok || extensions.ok;
  return {
    at: new Date().toISOString(),
    pbx: {
      reachable,
      error: reachable ? null : status.error,
      model: info.value?.['product-model'] ?? null,
      firmware: info.value?.['prog-version'] ?? null,
      uptimeSec: parseUptime(status.value?.['up-time']),
      systemTime: status.value?.['system-time'] ?? null,
    },
    extensions: extensions.value ?? null,
    trunks: [
      ...(voip.value ?? []).map((t) => ({ kind: 'voip', name: t.trunk_name ?? t.name, status: t.status ?? null, raw: t })),
      ...(analog.value ?? []).map((t) => ({ kind: 'analog', name: t.trunk_name ?? t.name, status: t.status ?? null, raw: t })),
    ],
    calls: {
      bridged: bridged.value ?? [],
      ringing: unbridged.value ?? [],
    },
    errors: Object.fromEntries(
      Object.entries({ status, info, extensions, voip, analog, bridged, unbridged })
        .filter(([, r]) => !r.ok)
        .map(([k, r]) => [k, r.error]),
    ),
  };
}

export function summarise(snap) {
  const ext = snap.extensions ?? [];
  const online = ext.filter((e) => e.registered).length;
  return {
    pbxUp: snap.pbx.reachable,
    firmware: snap.pbx.firmware,
    extensions: ext.length,
    online,
    offline: ext.length - online,
    trunks: snap.trunks.length,
    trunksDown: snap.trunks.filter((t) => isTrunkDown(t)).length,
    activeCalls: snap.calls.bridged.length,
    ringing: snap.calls.ringing.length,
  };
}

const isTrunkDown = (t) => /unreach|unavail|fail|reject|down/i.test(String(t.status ?? ''));

/** Compare two snapshots and return a list of events. */
export function diffSnapshots(prev, next) {
  const events = [];
  const at = next.at;
  if (prev?.pbx.reachable !== next.pbx.reachable) {
    events.push({ at, type: next.pbx.reachable ? 'pbx.up' : 'pbx.down', severity: next.pbx.reachable ? 'info' : 'critical', detail: next.pbx.error });
  }
  if (prev?.pbx.uptimeSec != null && next.pbx.uptimeSec != null && next.pbx.uptimeSec < prev.pbx.uptimeSec) {
    events.push({ at, type: 'pbx.rebooted', severity: 'warning', detail: `uptime reset to ${next.pbx.uptimeSec}s` });
  }
  if (prev?.pbx.firmware && next.pbx.firmware && prev.pbx.firmware !== next.pbx.firmware) {
    events.push({ at, type: 'pbx.firmware_changed', severity: 'warning', detail: `${prev.pbx.firmware} -> ${next.pbx.firmware}` });
  }
  if (prev?.extensions && next.extensions) {
    const before = new Map(prev.extensions.map((e) => [e.extension, e]));
    const after = new Map(next.extensions.map((e) => [e.extension, e]));
    for (const [ext, e] of after) {
      const b = before.get(ext);
      if (!b) events.push({ at, type: 'extension.added', severity: 'info', extension: ext, name: e.name });
      else if (b.registered !== e.registered) {
        events.push({ at, type: e.registered ? 'extension.online' : 'extension.offline', severity: e.registered ? 'info' : 'warning', extension: ext, name: e.name, ip: e.ip ?? b.ip });
      } else if (e.registered && b.ip && e.ip && b.ip !== e.ip) {
        events.push({ at, type: 'extension.moved', severity: 'info', extension: ext, name: e.name, detail: `${b.ip} -> ${e.ip}` });
      }
      if (b && b.name !== e.name) events.push({ at, type: 'extension.renamed', severity: 'warning', extension: ext, detail: `"${b.name}" -> "${e.name}"` });
    }
    for (const [ext, b] of before) {
      if (!after.has(ext)) events.push({ at, type: 'extension.removed', severity: 'critical', extension: ext, name: b.name });
    }
  }
  if (prev) {
    const key = (t) => `${t.kind}:${t.name}`;
    const before = new Map(prev.trunks.map((t) => [key(t), t]));
    for (const t of next.trunks) {
      const b = before.get(key(t));
      if (b && isTrunkDown(b) !== isTrunkDown(t)) {
        events.push({ at, type: isTrunkDown(t) ? 'trunk.down' : 'trunk.up', severity: isTrunkDown(t) ? 'critical' : 'info', trunk: t.name, detail: t.status });
      }
    }
  }
  return events;
}

/**
 * Holds warning events for a grace period so short blips don't page anyone,
 * and drops a pending offline alert if the matching online event arrives first.
 */
export class AlertEngine {
  constructor({ graceMs = 120_000, quietHours = null, now = () => Date.now() } = {}) {
    this.graceMs = graceMs;
    this.quietHours = quietHours; // { start: 22, end: 6 } local hours, criticals still fire
    this.now = now;
    this.pending = new Map();
  }

  #key(e) { return `${e.type.split('.')[0]}:${e.extension ?? e.trunk ?? 'pbx'}`; }

  #quiet() {
    if (!this.quietHours) return false;
    const h = new Date(this.now()).getHours();
    const { start, end } = this.quietHours;
    return start > end ? h >= start || h < end : h >= start && h < end;
  }

  /** Feed events; returns the alerts that should be sent now. */
  push(events) {
    const out = [];
    for (const e of events) {
      const k = this.#key(e);
      if (/\.(online|up)$/.test(e.type) && this.pending.has(k)) { this.pending.delete(k); continue; }
      if (e.severity === 'critical') { out.push(e); continue; }
      if (e.severity === 'warning' && this.graceMs > 0) { this.pending.set(k, { event: e, due: this.now() + this.graceMs }); continue; }
      if (e.severity === 'warning') out.push(e);
    }
    return out.concat(this.tick());
  }

  /** Release pending alerts whose grace period has passed. */
  tick() {
    const out = [];
    for (const [k, p] of this.pending) {
      if (p.due <= this.now()) { this.pending.delete(k); if (!this.#quiet()) out.push(p.event); }
    }
    return out;
  }
}
