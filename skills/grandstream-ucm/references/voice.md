# Voice control

## Option 1: built-in console (no API key)

```bash
UCM_HOST=192.168.1.10:8089 UCM_USER=api UCM_ALLOW_WRITES=dialExtension npx @ucm-control-kit/voice
```

Then open http://127.0.0.1:8765 in Chrome or Edge.

- **How to talk to it:** hold the mic button or the Space bar and speak. Examples: "which phones are offline", "is the PBX healthy", "status at Lake View", "test call from Harbour Road to Hill Street".
- **Confirmation:** a test call is only placed after you say "yes".
- **Network exposure:** the console listens on 127.0.0.1 only. Set `VOICE_BIND` only on a trusted network.

## Option 2: an LLM voice agent

Export the tool definitions in the format your platform expects, then pass tool calls to `runTool(client, name, args, ctx)`:

```js
import { exportTools, runTool, clientFromEnv } from '@ucm-control-kit/core';
const tools = exportTools('openai');     // OpenAI Realtime / Responses
// exportTools('elevenlabs')             // ElevenLabs Conversational AI client tools
// exportTools('gemini')                 // Gemini Live functionDeclarations
// exportTools('anthropic')              // Claude tool use
const client = clientFromEnv();
const result = await runTool(client, call.name, JSON.parse(call.arguments), { sites });
```

`runTool` enforces the confirmation rule. A write tool called without `confirm: true` returns `{ needsConfirmation: true }`. The agent should then ask the user, and call the tool again only after a clear yes.

Put this in the agent's system prompt:

> You manage a phone system. Read tools are safe. Before test_call, say exactly what will ring and wait for the user to say yes. If a name matches several extensions, ask which one.
