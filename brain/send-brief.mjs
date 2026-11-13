// Sends data/brief.json as an ntfy push notification.
// Usage: NTFY_TOPIC=... node brain/send-brief.mjs [--dry-run] [--force]
// Without --force it only sends when the brief is dated today in New York.
// Spoiler recaps are never sent: only their label goes out.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = 'https://joebentham.github.io/sport-brain/';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

const brief = JSON.parse(await readFile(process.env.BRIEF_FILE || join(ROOT, 'data', 'brief.json'), 'utf8'));
const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

if (!force && brief.date !== todayNY) {
  console.log(`Brief is dated ${brief.date}, today in New York is ${todayNY}. Not sending.`);
  process.exit(0);
}

// Sport emoji for a brief line: match it to an event in today.json by team names,
// then fall back to keywords. No match means no emoji.
const EMOJI = { soccer: '⚽', football: '🏈', cricket: '🏏', rugby: '🏉', basketball: '🏀', hockey: '🏒', darts: '🎯',
  curling: '🥌', baseball: '⚾', tennis: '🎾', golf: '⛳', snooker: '🎱', cycling: '🚴', athletics: '🏃', running: '🏃',
  motorsport: '🏎️', f1: '🏎️', boxing: '🥊', mma: '🥊', swimming: '🏊', chess: '♟️', sumo: '🤼' };
const KEYWORDS = [[/\b(ODI|T20|Test match|Ashes|wicket)/i, 'cricket'], [/\bdarts|Bunting|Littler/i, 'darts'],
  [/\bNFL|Thursday Night Football|touchdown/i, 'football'], [/\brugby|Six Nations/i, 'rugby'], [/\bNBA\b/i, 'basketball'],
  [/\bNHL\b/i, 'hockey'], [/\bcurling/i, 'curling'], [/\b(Premier League|Champions League|Nations League|FA Cup)/i, 'soccer']];
let events = [];
try { events = JSON.parse(await readFile(join(ROOT, 'data', 'today.json'), 'utf8')).events || []; } catch {}
const names = e => [e.home, e.away].filter(Boolean).flatMap(n => [n, n.split(' ').pop()]).filter(n => n.length > 2);
function sportOf(line) {
  let best = null, bestHits = 0;
  for (const e of events) {
    const hits = [e.home, e.away].filter(team => team && names({ home: team }).some(n => line.includes(n))).length;
    if (hits > bestHits) { best = e; bestHits = hits; }
  }
  if (best) return best.sport;
  return KEYWORDS.find(([re]) => re.test(line))?.[1];
}
const withEmoji = line => { const e = EMOJI[sportOf(line)]; return e ? `${e} ${line}` : line; };

// Plain text: the iPhone notification shows markdown as raw asterisks.
// The headline is the title; the phone already shows when it arrived.
function formatBrief(b) {
  const sections = [];
  if (b.today?.length) sections.push(['Today', ...b.today.map(t => withEmoji(t.replace(/^(\d{1,2}:\d{2}\s*[AP]M):\s*/i, '$1 · ')))]);
  if (b.recaps?.length) sections.push(['Yesterday', ...b.recaps.map(r => r.spoiler ? `🙈 ${r.label || 'Result'}: hidden to avoid spoilers` : withEmoji(r.text))]);
  if (b.lookAhead) sections.push(['Coming up', `🔭 ${b.lookAhead}`]);
  return { title: b.headline || 'Today in sport', message: sections.map(s => s.join('\n')).join('\n\n') };
}

const { title, message } = formatBrief(brief);
if (dryRun) {
  console.log(`${title}\n\n${message}`);
  process.exit(0);
}

const topic = process.env.NTFY_TOPIC;
if (!topic) {
  console.error('NTFY_TOPIC is not set.');
  process.exit(1);
}
// Attach the image card when the renderer is installed (the workflow installs it); otherwise text only.
let png = null;
try { png = await (await import('./brief-card.mjs')).cardPng(brief, sportOf); } catch (e) { console.log(`No card image: ${e.message}`); }
const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
const res = png
  ? await fetch(`${server}/${encodeURIComponent(topic)}?${new URLSearchParams({ title, message, click: BOARD })}`, {
      method: 'PUT', headers: { Filename: `brief-${brief.date}.png` }, body: png })
  : await fetch(server, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, title, message, click: BOARD }) });
if (!res.ok) {
  console.error(`ntfy returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`Sent brief for ${brief.date}${png ? ' with card' : ''}.`);
