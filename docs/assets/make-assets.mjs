// Generates the README hero banner and feature cards in dark and light variants.
// Run: node docs/assets/make-assets.mjs
import { writeFile } from 'node:fs/promises';

const THEMES = {
  dark: { bg: '#0B1020', bg2: '#121A33', line: '#26345F', text: '#EEF2FF', muted: '#93A0C8', accent: '#5B8CFF', accent2: '#22D3A6', warn: '#F5A524', bad: '#FF5D6C' },
  light: { bg: '#F6F8FD', bg2: '#FFFFFF', line: '#DCE3F2', text: '#0E1630', muted: '#56627F', accent: '#2F6BFF', accent2: '#0FA888', warn: '#C27C00', bad: '#D93448' },
};
const FONT = `font-family="Inter, Segoe UI, system-ui, -apple-system, sans-serif"`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function hero(t) {
  const W = 1280;
  const H = 580;
  const pbx = { x: 640, y: 300 };
  const sites = [
    [300, 190, 'Branch A', true], [250, 300, 'Branch B', true], [300, 410, 'Branch C', false],
    [980, 190, 'Branch D', true], [1030, 300, 'Branch E', true], [980, 410, 'Warehouse', true],
  ];
  const clients = ['Claude', 'Cursor', 'ChatGPT', 'Gemini', 'Voice', 'CLI'];
  const phone = (x, y, label, ok) => `
    <g transform="translate(${x},${y})">
      <line x1="0" y1="0" x2="${pbx.x - x}" y2="${pbx.y - y}" stroke="${ok ? t.accent : t.bad}" stroke-width="2" stroke-dasharray="${ok ? '0' : '6 6'}" opacity=".55"/>
      <rect x="-70" y="-24" width="140" height="48" rx="12" fill="${t.bg2}" stroke="${t.line}"/>
      <circle cx="-48" cy="0" r="6" fill="${ok ? t.accent2 : t.bad}"/>
      <text x="-34" y="-2" ${FONT} font-size="14" font-weight="600" fill="${t.text}">${label}</text>
      <text x="-34" y="14" ${FONT} font-size="11" fill="${t.muted}">${ok ? 'registered' : 'offline · fix ready'}</text>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="UCM Control Kit: AI agents and voice controlling a Grandstream phone system across branches">
  <defs>
    <radialGradient id="glow" cx="50%" cy="58%" r="45%"><stop offset="0" stop-color="${t.accent}" stop-opacity=".28"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${t.line}" stroke-width="1" opacity=".5"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" rx="24" fill="${t.bg}"/>
  <rect width="${W}" height="${H}" rx="24" fill="url(#grid)" opacity=".6"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="64" y="78" ${FONT} font-size="44" font-weight="800" fill="${t.text}" letter-spacing="-1">UCM Control Kit</text>
  <text x="64" y="112" ${FONT} font-size="19" fill="${t.muted}">Audit, monitor, repair and voice-control Grandstream phone systems from any AI agent</text>
  ${sites.map((s) => phone(...s)).join('')}
  <g transform="translate(${pbx.x},${pbx.y})">
    <circle r="86" fill="${t.bg2}" stroke="url(#core)" stroke-width="3"/>
    <circle r="100" fill="none" stroke="${t.accent}" stroke-opacity=".25" stroke-dasharray="3 7"/>
    <rect x="-44" y="-30" width="88" height="44" rx="8" fill="none" stroke="${t.text}" stroke-width="2.5"/>
    <g fill="${t.accent2}">${[0, 1, 2, 3, 4].map((i) => `<rect x="${-34 + i * 15}" y="-20" width="9" height="6" rx="2"/>`).join('')}</g>
    <g fill="${t.muted}">${[0, 1, 2, 3, 4].map((i) => `<rect x="${-34 + i * 15}" y="-8" width="9" height="12" rx="2"/>`).join('')}</g>
    <text y="40" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="${t.text}">UCM PBX</text>
    <text y="58" text-anchor="middle" ${FONT} font-size="11" fill="${t.muted}">HTTPS API · :8089</text>
  </g>
  <g transform="translate(${W / 2 - (clients.length * 118) / 2},528)">
    ${clients.map((c, i) => `<g transform="translate(${i * 118},0)">
      <line x1="52" y1="0" x2="${pbx.x - (W / 2 - (clients.length * 118) / 2) - i * 118}" y2="${pbx.y + 100 - 528}" stroke="${t.accent2}" stroke-opacity=".35" stroke-width="1.5"/>
      <rect x="0" y="-18" width="104" height="36" rx="18" fill="${t.bg2}" stroke="${t.line}"/>
      <text x="52" y="5" text-anchor="middle" ${FONT} font-size="13" font-weight="600" fill="${t.text}">${c === 'Voice' ? '🎙 ' : ''}${c}</text></g>`).join('')}
  </g>
  <g transform="translate(${W - 64},70)" text-anchor="end">
    <text ${FONT} font-size="12" fill="${t.muted}">MCP server · Agent Skill · CLI · Voice</text>
    <text y="20" ${FONT} font-size="12" fill="${t.muted}">Tested: UCM6304 · fw 1.0.33.30</text>
  </g>
</svg>`;
}

const CARDS = [
  ['audit', 'Audit', 'See every action your API user can read and the permissions it is missing.', 'M4 6h16M4 12h10M4 18h7M17 15l2 2 4-4'],
  ['monitor', 'Monitor', 'Offline phones, reboots, trunk failures and live calls, with alerts that ignore short dropouts.', 'M3 12h4l3-7 4 14 3-7h4'],
  ['reconcile', 'Reconcile', 'Find sites whose recorded extension is wrong, using name and subnet matching.', 'M4 7h12l-3-3M20 17H8l3 3'],
  ['recover', 'Recover', 'Picks the smallest fix: network, missing, drifted or phone-side. Never blanks a value.', 'M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4'],
  ['testcall', 'Test call', 'Ring one branch, connect it to another, and confirm the call bridges.', 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2'],
  ['voice', 'Voice', 'Push-to-talk in the browser with no API key, plus schemas for ElevenLabs, OpenAI and Gemini.', 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3'],
  ['calls', 'Call reports', 'Calls made, received and missed per branch and per person, with talk time and top routes.', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['edit', 'Admin edits', 'Change an extension name, email, caller ID or permission. Preview the diff, then confirm.', 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4'],
  ['mcp', 'Any agent', 'MCP server and Agent Skill for Claude, Cursor, VS Code, ChatGPT, Gemini and more.', 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14'],
];

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > max) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  return [...lines, line];
}

function card(t, [, title, body, icon]) {
  const W = 400;
  const H = 180;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}: ${esc(body)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient></defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="${t.bg2}" stroke="${t.line}"/>
  <rect x="24" y="24" width="48" height="48" rx="12" fill="url(#g)"/>
  <path d="${icon}" transform="translate(36,36)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="88" y="56" ${FONT} font-size="22" font-weight="700" fill="${t.text}">${title}</text>
  ${wrap(body, 44).map((l, i) => `<text x="24" y="${106 + i * 22}" ${FONT} font-size="15" fill="${t.muted}">${esc(l)}</text>`).join('')}
</svg>`;
}

const dir = new URL('./', import.meta.url);
for (const [name, t] of Object.entries(THEMES)) {
  await writeFile(new URL(`hero-${name}.svg`, dir), hero(t));
  for (const c of CARDS) await writeFile(new URL(`card-${c[0]}-${name}.svg`, dir), card(t, c));
}
console.log('assets written');
