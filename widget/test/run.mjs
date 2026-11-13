// Exercises the widget's logic and layout code under Node with a stub of Scriptable's globals.
// It does not draw anything; it records what the widget would contain and checks the rules.
// Run: TZ=America/New_York node widget/test/run.mjs   (fetches the live today.json; pass a file path to use a saved copy)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(here + '../sport-brain-widget.js', 'utf8');
const real = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await (await fetch('https://joebentham.github.io/sport-brain/data/today.json')).json();

// ---- Scriptable stubs
class Node_ { constructor(kind) { this.kind = kind; this.children = []; } }
class Stack extends Node_ {
  constructor(kind = 'stack') { super(kind); }
  addText(s) { const t = Object.assign(new Node_('text'), { text: s, centerAlignText() {}, rightAlignText() {} }); this.children.push(t); return t; }
  addImage(i) { const n = Object.assign(new Node_('image'), { image: i }); this.children.push(n); return n; }
  addStack() { const s = new Stack(); this.children.push(s); return s; }
  addSpacer(n) { this.children.push(Object.assign(new Node_('spacer'), { n })); }
  addDate(d) { return this.addText(String(d)); }
  setPadding() {} useDefaultPadding() {} layoutHorizontally() {} layoutVertically() {}
  topAlignContent() {} centerAlignContent() {} bottomAlignContent() {}
}
class ListWidget extends Stack { constructor() { super('widget'); } async presentMedium() { this.presented = true; } }
const fontProxy = new Proxy({}, { get: (_, name) => (size) => ({ name, size }) });
const files = new Map();
let net = { offline: false, espn: {} };
const env = {
  ListWidget,
  Color: class { constructor(hex, a) { this.hex = hex; this.a = a; } },
  LinearGradient: class {},
  Font: fontProxy,
  Size: class { constructor(w, h) { this.w = w; this.h = h; } },
  Rect: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } },
  DrawContext: class { setFillColor() {} fillEllipse() {} getImage() { return { dot: true }; } },
  Request: class {
    constructor(url) { this.url = url; }
    async loadJSON() {
      if (net.offline) throw new Error('offline');
      if (this.url.includes('today.json')) return structuredClone(net.data);
      const feed = this.url.split('/sports/')[1].replace('/scoreboard', '');
      if (net.espn[feed]) return net.espn[feed];
      throw new Error('no feed stub ' + feed);
    }
  },
  FileManager: { local: () => ({
    documentsDirectory: () => '/docs', joinPath: (a, b) => a + '/' + b,
    fileExists: (p) => files.has(p), readString: (p) => files.get(p), writeString: (p, s) => files.set(p, s),
  }) },
  Script: { setWidget(w) { env.Script.widget = w; }, complete() {} },
  config: { runsInWidget: true, widgetFamily: 'small' },
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const names = Object.keys(env);
const mod = { exports: {}, __noMain: true };
await new AsyncFunction('module', ...names, src)(mod, ...names.map((n) => env[n]));
const W = mod.exports;

const textOf = (n) => n.kind === 'text' ? [n.text] : (n.children || []).flatMap(textOf);
async function render(family, data, now) {
  net.data = data;
  env.config.widgetFamily = family;
  const RealDate = Date;
  // Freeze "now" inside the widget.
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now.getTime()])); } static now() { return now.getTime(); } };
  try { await W.main(); } finally { globalThis.Date = RealDate; }
  const w = env.Script.widget;
  return { w, lines: textOf(w) };
}

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

// ---------- 1. Real data as published, at its own build time
console.log('\n1. Real today.json at generatedAt (' + real.generatedAt + ')');
{
  const now = new Date(real.generatedAt);
  const sel = W.choose(structuredClone(real.events), now);
  console.log('  top:', sel.top && sel.top.title, '| rest:', sel.rest.slice(0, 3).map((e) => e.title).join(' / '));
  ok(sel.top && !sel.top.timeTbc, 'picks a game with a confirmed time');
  ok(sel.top && (W.rank(sel.top) < 2 || sel.live.length), 'top game is tier 1 or a pick when nothing is live');
  for (const fam of ['small', 'medium', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    const { w, lines } = await render(fam, real, now);
    console.log(`  [${fam}] url=${w.url}\n    ` + lines.join(' | '));
  }
}

// ---------- 2. Faked live games: a tier-1 game with a score, and a hideScore game
console.log('\n2. Faked live game + faked hideScore game, ESPN feeds stubbed');
{
  const data = structuredClone(real);
  const now = new Date(Date.parse(real.generatedAt) + 60 * 6e4);
  const live = data.events.find((e) => e.tier === 1 && e.state === 'pre' && e.feed && e.home);
  live.start = new Date(now - 40 * 6e4).toISOString(); live.state = 'in'; live.score = { home: '0', away: '0' }; live.statusText = "40'";
  const hidden = {
    ...structuredClone(live), id: 'soccer-999001', sport: 'soccer', league: 'Premier League', feed: 'soccer/eng.1',
    title: 'Chelsea at Arsenal', home: 'Arsenal', away: 'Chelsea', homeAbbr: 'ARS', awayAbbr: 'CHE', tier: 1, hideScore: true,
    start: new Date(now - 20 * 6e4).toISOString(), state: 'in', score: { home: '3', away: '2' }, statusText: "20' 3-2",
    watch: { options: [{ key: 'peacock', name: 'Peacock', owned: true, url: 'https://www.peacocktv.com/' }] },
  };
  data.events.push(hidden);
  const espnEvent = (id, home, away, state, summary) => ({ id, competitions: [{ status: { summary, type: { state } },
    competitors: [{ homeAway: 'home', score: home }, { homeAway: 'away', score: away }] }] });
  net.espn = {
    [live.feed]: { events: [espnEvent(W.espnId(live), '2', '1', 'in', "52'")] },
    'soccer/eng.1': { events: [espnEvent('999001', '4', '2', 'in', "33'")] },
  };

  const sel = W.choose(structuredClone(data.events), now);
  ok(sel.live.some((e) => e.id === live.id) && sel.live.some((e) => e.id === hidden.id), 'both faked games count as live');
  ok(W.wantsPoll(live, now) && W.wantsPoll(hidden, now), 'both live games are polled');

  for (const fam of ['small', 'medium', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
    const { w, lines } = await render(fam, data, now);
    console.log(`  [${fam}] url=${w.url}\n    ` + lines.join(' | '));
    const all = lines.join(' ');
    ok(!/\b4\b|\b3\b|4–2|3–2|33'|20'/.test(all.replace(/\d{1,2}:\d\d/g, '')), `${fam}: no Arsenal score or clock anywhere`);
  }
  const { lines } = await render('small', data, now);
  ok(lines.includes('2') && lines.includes('1'), 'small: fresh ESPN score (2–1) replaced the hourly 0–0');
  ok(lines.includes("52'"), 'small: fresh ESPN clock shown');

  // hideScore game as the top game (it is tier 1 and starts later, so put it first by making the other a pick)
  const d2 = structuredClone(data);
  d2.events.find((e) => e.id === live.id).tier = 'wildcard';
  const r2 = await render('small', d2, now);
  console.log('  [small, hideScore on top] ' + r2.lines.join(' | '));
  ok(r2.lines.includes('Arsenal') && r2.lines.includes('LIVE'), 'hideScore top game shows teams and LIVE');
  ok(!r2.lines.some((l) => /^\d+$/.test(l)), 'hideScore top game shows no score numbers');
  ok(r2.lines.includes('Score hidden'), 'hideScore top game says the score is hidden');
  ok(r2.w.url === 'https://www.peacocktv.com/', 'tap opens the owned service');
  const m2 = await render('medium', d2, now);
  console.log('  [medium, hideScore on top] ' + m2.lines.join(' | '));
  ok(m2.lines.includes('2–1') && m2.lines.includes("52' · "), 'medium: a live game in the list shows its score and clock');
  ok(!m2.lines.some((l) => /^\d+$/.test(l)), 'medium: hidden-score game on top shows no score numbers');
  const colorOf = (n, text) => n.text === text ? n.textColor : (n.children || []).map((c) => colorOf(c, text)).find(Boolean);
  const sm = await render('small', data, now);
  ok(colorOf(sm.w, 'ENG').hex === '#8E8E93' && colorOf(sm.w, 'AUS').hex === '#FFFFFF', 'scoreboard dims the team that is behind');
  const r3 = await render('accessoryRectangular', d2, now);
  ok(r3.lines[1] === '● LIVE', 'Lock Screen: hideScore second line is just "● LIVE"');

  const late = { ...live, state: 'pre', score: null, statusText: '11/12 - 8:15 PM EST' };
  ok(W.stateLine(late, now) === 'LIVE', 'started-but-not-yet-updated game reads "LIVE", not its kickoff text');

  // Final with hideScore
  const fin = { ...hidden, state: 'post', statusText: 'FT' };
  ok(W.stateLine(fin, now) === 'Final', 'hideScore final reads "Final" with no numbers');
}

// ---------- 3. Watch labels and tap targets
console.log('\n3. Watch labels');
{
  const e = (options) => ({ watch: { options } });
  ok(W.watchLabel(e([{ name: 'Fubo', owned: false, url: 'x' }])) === 'Not on your services', 'unowned only → Not on your services');
  ok(W.watchLabel(e([{ name: 'Fubo', owned: false }, { name: 'Peacock', owned: true }])) === 'Peacock', 'first owned option wins');
  ok(W.watchLabel(e([{ name: 'Willow', owned: null }])) === 'Willow?', 'unconfirmed (owned null) gets a question mark');
  ok(W.tapUrl(e([{ name: 'Fubo', owned: false, url: 'https://fubo' }])) === 'https://joebentham.github.io/sport-brain/', 'no owned service → board URL');
  ok(W.tapUrl(e([])) === 'https://joebentham.github.io/sport-brain/', 'no options → board URL');
}

// ---------- 4. Offline: falls back to the cache and marks it stale
console.log('\n4. Offline with cache');
{
  const now = new Date(Date.parse(real.generatedAt) + 30 * 6e4);
  await render('small', real, now); // fills the cache
  net.offline = true;
  const { lines } = await render('small', real, now);
  net.offline = false;
  console.log('    ' + lines.join(' | '));
  ok(lines.some((l) => l.startsWith('⚠︎ Stale')), 'shows the stale marker');
  ok(lines.length > 3, 'still shows a game from the cache');
  files.clear(); net.offline = true;
  const empty = await render('medium', real, now);
  net.offline = false;
  console.log('    [no cache] ' + empty.lines.join(' | '));
  ok(empty.lines.some((l) => /No connection/.test(l)), 'no cache → friendly message, no crash');
}

// ---------- 5. timeTbc skipped, nothing live → nextRefresh
console.log('\n5. Misc');
{
  const now = new Date(real.generatedAt);
  const evs = [{ id: 'x-1', sport: 'curling', tier: 1, state: 'pre', timeTbc: true, start: new Date(+now + 6e4).toISOString(), title: 'TBC thing', watch: { options: [] } }];
  ok(W.choose(evs, now).top === null, 'timeTbc events are skipped');
  const sel = W.choose(structuredClone(real.events), now);
  const r = W.nextRefresh(sel, now);
  ok(r - now >= 5 * 6e4 && r - now <= 30 * 6e4, `refresh asked for in ${Math.round((r - now) / 6e4)} min`);
  const darts = real.events.find((e) => !e.home);
  if (darts) ok(W.shortMatchup(darts) === darts.title, 'events without teams use their title');
}

console.log(`\nAll ${passed} checks passed.`);
