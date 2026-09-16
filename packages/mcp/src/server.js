#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { clientFromEnv, runTool, TESTED_PLATFORM, TOOLS } from '@ucm-control-kit/core';
import { z } from 'zod';

/**
 * MCP server exposing the kit's tools to any MCP client (Claude, Cursor, VS Code,
 * ChatGPT connectors, Gemini CLI, ...).
 *
 * Env: UCM_HOST, UCM_USER, UCM_PASSWORD, optional UCM_ALLOW_WRITES (e.g. dialExtension),
 * UCM_SITES (path to a JSON site registry used for names and reconcile).
 */

/** Convert the kit's small JSON schemas into zod shapes for the SDK. */
function toZod(schema) {
  const shape = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    let t = prop.type === 'boolean' ? z.boolean() : prop.type === 'number' ? z.number() : prop.type === 'object' ? z.record(z.string(), z.string()) : z.string();
    if (prop.description) t = t.describe(prop.description);
    if (!(schema.required ?? []).includes(key)) t = t.optional();
    shape[key] = t;
  }
  return shape;
}

async function loadSites(path) {
  if (!path) return [];
  const raw = JSON.parse((await readFile(path, 'utf8')).trimStart());
  return Array.isArray(raw) ? raw : raw.branches ?? raw.sites ?? [];
}

export async function createServer({ client = clientFromEnv(), sites = [] } = {}) {
  const server = new McpServer({ name: 'ucm-control-kit', version: '0.1.0' });
  const ctx = { sites, state: {} };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.description}${tool.write ? ' (changes state)' : ''}`,
        inputSchema: toZod(tool.input),
        annotations: { readOnlyHint: !tool.write, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          const result = await runTool(client, tool.name, args, ctx);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
      },
    );
  }

  server.registerResource(
    'platform',
    'ucm://platform',
    { title: 'Tested platform', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(TESTED_PLATFORM) }] }),
  );

  return server;
}

const invoked = process.argv[1] && pathToFileURL(await realpath(process.argv[1])).href;
if (invoked === import.meta.url) {
  const server = await createServer({ sites: await loadSites(process.env.UCM_SITES) });
  await server.connect(new StdioServerTransport());
}
