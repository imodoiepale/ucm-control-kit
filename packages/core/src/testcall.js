/**
 * Place a test call between two extensions and watch the PBX until it bridges.
 *
 * The UCM rings `from` first; when answered it dials `to`. The call passes when a bridged
 * channel containing both extensions appears. A human should still confirm audio.
 */
export async function testCall(client, { from, to, timeoutMs = 60_000, pollMs = 2_000, sleep = defaultSleep, onProgress = () => {} }) {
  from = String(from);
  to = String(to);
  if (from === to) throw new Error('Test call needs two different extensions');

  const exts = await client.extensions();
  const a = exts.find((e) => e.extension === from);
  const b = exts.find((e) => e.extension === to);
  if (!a) return result('failed', `Extension ${from} does not exist`);
  if (!b) return result('failed', `Extension ${to} does not exist`);
  if (!a.registered) return result('failed', `Extension ${from} (${a.name}) has no registered phone`);
  if (!b.registered) return result('failed', `Extension ${to} (${b.name}) has no registered phone`);

  const started = Date.now();
  await client.dialExtension(from, to);
  onProgress({ stage: 'ringing', from, to });

  let rang = false;
  while (Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    const [bridged, ringing] = await Promise.all([client.bridgedChannels(), client.unbridgedChannels()]);
    if (bridged.some((c) => mentions(c, from) && mentions(c, to))) {
      onProgress({ stage: 'connected', from, to });
      return result('connected', `${a.name} (${from}) and ${b.name} (${to}) are connected. Ask both sides to confirm they can hear each other.`, Date.now() - started);
    }
    if (ringing.some((c) => mentions(c, from) || mentions(c, to))) rang = true;
  }
  return result(rang ? 'no-answer' : 'failed', rang ? 'The phones rang but nobody answered in time.' : 'The PBX never showed the call. Check the extensions and API permissions.', Date.now() - started);
}

const mentions = (channel, ext) => JSON.stringify(channel).includes(`"${ext}"`) || JSON.stringify(channel).includes(`/${ext}-`);
const result = (outcome, message, ms = 0) => ({ outcome, passed: outcome === 'connected', message, ms });
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
