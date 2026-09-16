# MCP setup

The server runs over stdio: `npx -y @ucm-control-kit/mcp`.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `UCM_HOST` | yes | `ip:port` or URL of the UCM, e.g. `192.168.1.10:8089` |
| `UCM_USER` | yes | API user from **API Settings (New)** |
| `UCM_PASSWORD` | yes | That user's password. Use your client's secret store where it has one |
| `UCM_ALLOW_WRITES` | no | e.g. `dialExtension` for test calls, `updateSIPAccount,applyChanges` for admin edits |
| `UCM_DRY_RUN` | no | `1` to preview writes without sending them |
| `UCM_SITES` | no | Path to a site registry JSON, used for branch names, reconcile and call reports |

Leave `UCM_ALLOW_WRITES` empty for a read-only assistant.

## Claude Code

```bash
claude mcp add ucm \
  -e UCM_HOST=192.168.1.10:8089 -e UCM_USER=api_user -e UCM_PASSWORD="$UCM_PASSWORD" \
  -e UCM_SITES=/path/to/sites.json -e UCM_ALLOW_WRITES=dialExtension \
  -- npx -y @ucm-control-kit/mcp
```

## Claude Desktop, Cursor, Windsurf, Cline, Gemini CLI

These clients all use the same JSON shape. Put it in the file for your client:

- Claude Desktop: `claude_desktop_config.json`
- Cursor: `.cursor/mcp.json`
- Gemini CLI: `~/.gemini/settings.json`
- Windsurf and Cline: their MCP settings

```json
{
  "mcpServers": {
    "ucm": {
      "command": "npx",
      "args": ["-y", "@ucm-control-kit/mcp"],
      "env": {
        "UCM_HOST": "192.168.1.10:8089",
        "UCM_USER": "api_user",
        "UCM_PASSWORD": "set-me",
        "UCM_SITES": "/path/to/sites.json"
      }
    }
  }
}
```

## VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "inputs": [{ "id": "ucm-password", "type": "promptString", "description": "UCM API password", "password": true }],
  "servers": {
    "ucm": {
      "command": "npx",
      "args": ["-y", "@ucm-control-kit/mcp"],
      "env": { "UCM_HOST": "192.168.1.10:8089", "UCM_USER": "api_user", "UCM_PASSWORD": "${input:ucm-password}" }
    }
  }
}
```

## OpenAI Agents SDK / Responses API

Connect through an MCP connector, or call the tools directly:

```js
import { exportTools, runTool, clientFromEnv } from '@ucm-control-kit/core';
const tools = exportTools('openai');
// when the model calls a tool:
const output = await runTool(clientFromEnv(), call.name, JSON.parse(call.arguments), { sites });
```

## Tools

| Tool | Read-only | Notes |
|---|---|---|
| `pbx_status` | yes | |
| `list_extensions` | yes | `offline_only`, `search` |
| `extension_status` | yes | Takes a number or a site name. Returns a diagnosis |
| `active_calls` | yes | |
| `reconcile_sites` | yes | Needs `UCM_SITES` |
| `watch_changes` | yes | The first call takes a baseline |
| `call_report` | yes | `period` or `from`/`to`, plus `site` |
| `test_call` | no | Needs `confirm: true` and `dialExtension` allowed |
| `update_extension` | no | Without `confirm` it returns a preview. Needs `updateSIPAccount` (plus `applyChanges`) allowed |

The server also exposes the resource `ucm://platform`, which returns the tested model and firmware.
