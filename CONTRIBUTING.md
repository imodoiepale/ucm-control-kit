# Contributing

Thanks for helping.

## Setup

```bash
pnpm install
pnpm test      # runs against the fake UCM, no hardware needed
pnpm lint
pnpm demo      # fake UCM + voice console on http://127.0.0.1:8765
```

## Guidelines

- Keep `packages/core` free of runtime dependencies.
- Add every UCM action to `packages/core/src/actions.js`:
  - mark it `write: true` if it changes anything;
  - list a firmware under `tested` only after you've run it on real hardware.
- Add agent-facing behaviour as a tool in `packages/core/src/tools.js`, with a test.
- Never commit real PBX data. Fixtures are synthetic.
- Commit messages say *why* the change was made.

## Platform reports

Ran the kit on another model or firmware? Open a **Platform report** issue with the output of `ucm audit --json` and `ucm probe --json`. Remove names and IPs first.
