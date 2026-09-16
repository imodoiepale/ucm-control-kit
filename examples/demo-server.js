// Starts a fake UCM and the voice console against it, so you can try everything without hardware.
// Run: pnpm demo   then open the printed URL. CLI: use the printed UCM_* variables.
import { readFile } from 'node:fs/promises';
import { UcmClient } from '../packages/core/src/index.js';
import { startFakeUcm } from '../packages/core/test/fake-ucm.js';
import { createVoiceServer } from '../packages/voice/src/server.js';

const ucm = await startFakeUcm();
ucm.state.pageSize = 100;
const sites = JSON.parse(await readFile(new URL('./sites.example.json', import.meta.url), 'utf8'));
const client = new UcmClient({ host: ucm.host, user: 'api', password: 'secret', allowWrites: ['dialExtension', 'updateSIPAccount', 'applyChanges'] });
const voice = createVoiceServer({ client, sites });
voice.listen(8765, '127.0.0.1', () => {
  console.log('Fake UCM  :', ucm.host);
  console.log('Voice     : http://127.0.0.1:8765');
  console.log(`CLI       : UCM_HOST=${ucm.host} UCM_USER=api UCM_PASSWORD=secret node packages/cli/bin/ucm.js status`);
});
