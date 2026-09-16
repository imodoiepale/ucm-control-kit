# Changelog

## 0.1.0 (unreleased)

- `core`:
  - UCM HTTPS API client: challenge login, re-login, pagination, allow-listed writes, dry run;
  - audit, monitor and alert engine, reconcile, diagnose, test call, call reports (CDR), admin extension edits;
  - one tool registry shared by all surfaces, with schema export for OpenAI, Anthropic, Gemini and ElevenLabs.
- `cli`: the `ucm` command with `status`, `extensions`, `audit`, `probe`, `reconcile`, `diagnose`, `call`, `calls`, `edit`, `watch` and `platform`.
- `mcp`: stdio MCP server with 9 tools and read-only hints.
- `voice`: push-to-talk console with spoken confirmation, no API key needed.
- `skills/grandstream-ucm`: Agent Skill with references.
- Tested on UCM6304, firmware 1.0.33.30.
