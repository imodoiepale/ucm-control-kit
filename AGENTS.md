# AGENTS.md

Guidance for AI coding and operations agents (Codex, Copilot, Cursor, Jules, Claude and others).

## Operating a Grandstream UCM with this repo

Follow [skills/grandstream-ucm/SKILL.md](skills/grandstream-ucm/SKILL.md). In short:

- **Tools:** use the MCP server (`@ucm-control-kit/mcp`) or the CLI (`packages/cli/bin/ucm.js ... --json`).
- **Workflow:** audit → reconcile → monitor → diagnose → fix → test call.
- **Reads:** read tools are always safe.
- **Writes:** `test_call` and `update_extension` need the user's explicit yes in this conversation before `confirm: true`. `update_extension` returns a preview first; show it to the user.
- **Ambiguous names:** never guess a branch when a name is ambiguous. Ask.
- **Credentials:** never ask for, print or store the UCM password in chat or files. It comes from `UCM_PASSWORD`.

## Working on the code

- Node 20+, pnpm workspaces, ESM JavaScript. `packages/core` has no runtime dependencies; keep it that way.
- Run tests with `pnpm test`. They use the fake UCM in `packages/core/test/fake-ucm.js`, so no hardware is needed.
- Every new UCM action goes in `packages/core/src/actions.js`:
  - mark it `write: true` if it changes anything;
  - add `tested` only after running it on real hardware.
- Every agent-facing tool goes in `packages/core/src/tools.js` so the CLI, MCP and voice surfaces stay in sync.
- Never commit real PBX data: names, IPs, audit output. Fixtures must be synthetic.
- Lint with `pnpm lint` (Biome).
