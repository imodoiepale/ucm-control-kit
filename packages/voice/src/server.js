#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clientFromEnv, exportTools, runTool, TOOLS } from '@ucm-control-kit/core';
import { parseIntent, speak } from './intents.js';

/**
 * Voice console: a small local web app with push-to-talk.
 * The browser does speech-to-text and text-to-speech; this server runs the tool.
 * Bind stays on 127.0.0.1 unless VOICE_BIND is set, because it can place calls.
 */
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createVoiceServer({ client, sites = [] }) {
  const ctx = { sites, state: {} };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((ok, fail) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { fail(e); } }); });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(await readFile(join(PUBLIC, 'index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/tools') {
        return json(res, 200, { tools: TOOLS.map(({ name, title, description, write, voice }) => ({ name, title, description, write: Boolean(write), examples: voice })) });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/tools/export/')) {
        return json(res, 200, exportTools(url.pathname.split('/').pop()));
      }
      if (req.method === 'POST' && url.pathname === '/api/say') {
        const { text } = await readBody(req);
        const intent = parseIntent(text);
        if (!intent) return json(res, 200, { reply: "Sorry, I didn't catch a command. Try: which phones are offline." });
        if (intent.kind !== 'tool') return json(res, 200, { intent });
        const result = await runTool(client, intent.tool, intent.args, ctx);
        if (result?.preview && result.ok && !result.noChange) {
          return json(res, 200, { intent, result, needsConfirmation: true, reply: speak(intent.tool, result) });
        }
        if (result?.needsConfirmation) {
          return json(res, 200, { intent, needsConfirmation: true, reply: confirmPrompt(intent) });
        }
        return json(res, 200, { intent, result, reply: speak(intent.tool, result) });
      }
      if (req.method === 'POST' && url.pathname === '/api/run') {
        const { tool, args } = await readBody(req);
        const result = await runTool(client, tool, args, ctx);
        return json(res, 200, { result, reply: speak(tool, result) });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 200, { error: e.message, reply: e.message });
    }
  });
}

function confirmPrompt(intent) {
  if (intent.tool === 'test_call') return `This will ring ${intent.args.from} and connect it to ${intent.args.to}. Say yes to go ahead.`;
  return 'This changes the phone system. Say yes to go ahead.';
}

const invoked = process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href;
if (invoked === import.meta.url) {
  const sites = process.env.UCM_SITES ? await readFile(process.env.UCM_SITES, 'utf8') : null;
  const parsed = sites ? JSON.parse(sites.trimStart()) : [];
  const server = createVoiceServer({ client: clientFromEnv(), sites: Array.isArray(parsed) ? parsed : parsed.branches ?? parsed.sites ?? [] });
  const port = Number(process.env.VOICE_PORT ?? 8765);
  const bind = process.env.VOICE_BIND ?? '127.0.0.1';
  server.listen(port, bind, () => console.log(`voice console on http://${bind}:${port}`));
}
