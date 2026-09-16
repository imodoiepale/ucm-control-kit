---
name: grandstream-ucm
description: Audit, monitor, repair and test a Grandstream UCM IP-PBX (UCM6300/6200 series) through its HTTPS API, using the ucm-control-kit CLI or MCP server. Use when someone asks whether phones or extensions are working, which branch phones are offline, to check or fix extension numbers in a site list, to diagnose an unregistered phone, to place a test call between extensions, to audit API permissions, to watch the PBX for changes, or to set up voice control of a phone system. Also use for questions about the UCM "API Settings (New)" page, challenge/login tokens, status codes like -37 or -47, or onboarding a new branch's phones.
license: MIT
compatibility: Node.js 20+, network access to the UCM on its HTTPS port (default 8089)
metadata:
  tested-platform: Grandstream UCM6304 firmware 1.0.33.30
  repository: https://github.com/imodoiepale/ucm-control-kit
---

# Grandstream UCM control

This skill drives a Grandstream UCM through the **new HTTPS API** (`POST https://<host>:8089/api`). The same seven tools are available three ways; use whichever the environment has:

| Surface | When | How |
|---|---|---|
| MCP server | The agent has MCP tools named `pbx_status`, `list_extensions`, ... | Call the tools directly |
| CLI | A shell is available | `npx @ucm-control-kit/cli <command> --json` |
| Library | Writing code | `import { UcmClient } from '@ucm-control-kit/core'` |

Tested on **UCM6304, firmware 1.0.33.30**. Other UCM63xx/62xx models use the same API but are unverified; say so when working on one.

## Setup check (do this first)

1. Needed env vars: `UCM_HOST` (e.g. `192.168.1.10:8089`), `UCM_USER`, `UCM_PASSWORD`. Never ask the user to paste the password into chat; ask them to set the variable or let the CLI prompt for it.
2. The API user is created in the UCM web UI: **Integrations → API Configuration → API Settings (New)**. "Enable API" must be on and the user must be **saved** (the list shows it).
3. Run `ucm audit`. Anything with status `-47` needs that permission ticked on the API user. See [references/status-codes.md](references/status-codes.md).

## Core workflow

```
audit → reconcile → monitor → diagnose → fix → test call
```

1. **Audit**: `ucm audit` lists what this user can read and which permissions are missing.
2. **Reconcile**: `ucm reconcile --registry sites.json` compares the organisation's site list with the PBX. Results: `ok`, `changed` (the site has a wrong number, a better match exists), `found` (no number recorded, match found), `conflict` (the recorded number belongs to someone else), `ambiguous` (several sites want one extension), `missing`, `none`, plus `unassigned` PBX accounts. Present `changed` with confidence below 0.9, and every `conflict`/`ambiguous`, for a human to decide. Never write registry changes without approval.
3. **Monitor**: `pbx_status` for a snapshot, `watch_changes` or `ucm watch` for events (`extension.offline`, `extension.removed`, `pbx.rebooted`, `trunk.down`). Offline warnings wait 2 minutes before alerting so blips are ignored.
4. **Diagnose**: `extension_status <ext or site name>` returns a cause:
   - `network`: the site is unreachable; fix connectivity, do not touch the PBX.
   - `extension-missing`: recreate from the last known-good record.
   - `out-of-service` or `drift`: restore only the changed fields; never blank a value.
   - `phone-side`: the extension is fine but no phone is registered. Use the last seen IP/model to guide the site (power, cable, re-provision).
   - `healthy`: confirm with a test call.
5. **Test call**: `test_call from to confirm=true` rings `from`, then bridges to `to`. Both sides should confirm they hear each other. See [references/test-calls.md](references/test-calls.md).

## Safety rules

- Read tools are free to use. `test_call` and any PBX write need **explicit user agreement in this conversation**; only then pass `confirm: true` (MCP) or set `UCM_ALLOW_WRITES` (CLI). A "yes" to one call does not cover the next.
- The client refuses writes that are not in its allowlist. Use `UCM_DRY_RUN=1` to preview writes.
- If a site name matches several extensions, the tools refuse and list the candidates. Ask; do not pick one.
- Do not delete extensions. Do not change the PBX from the UCM web UI on the user's behalf.
- The legacy "HTTPS API Settings (Old)" page (default user `cdrapi`) is deprecated. If it is enabled with the default password or with no permitted IPs, flag it as a security finding.

## Voice

- Built-in console: `npx @ucm-control-kit/voice` then open http://127.0.0.1:8765. It needs no API key (it uses the browser's speech recognition) and asks for a spoken "yes" before test calls.
- For LLM voice agents, export the tool schemas: `exportTools('elevenlabs' | 'openai' | 'gemini' | 'anthropic')`. Details are in [references/voice.md](references/voice.md).

## Multi-site guidance

When helping an organisation with many branches, recommend the following. [references/multi-site.md](references/multi-site.md) has the full playbook.
- The UCM display name should equal the site name, so reconcile always matches.
- Give each region an extension range and each site its own /24 subnet.
- Run a nightly audit and reconcile, and an overnight test call per site.
- Keep a snapshot of each extension's last known-good settings so recovery never starts from scratch.
