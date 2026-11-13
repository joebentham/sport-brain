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

// Plain text: the iPhone notification shows markdown as raw asterisks.
// The headline is the title; the phone already shows when it arrived.
function formatBrief(b) {
  const sections = [];
  if (b.today?.length) sections.push(['Today', ...b.today.map(t => t.replace(/^(\d{1,2}:\d{2}\s*[AP]M):\s*/i, '$1 · '))]);
  if (b.recaps?.length) sections.push(['Yesterday', ...b.recaps.map(r => r.spoiler ? `${r.label || 'Result'}: hidden to avoid spoilers` : r.text)]);
  if (b.lookAhead) sections.push(['Coming up', b.lookAhead]);
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
const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topic, title, message, click: BOARD }),
});
if (!res.ok) {
  console.error(`ntfy returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`Sent brief for ${brief.date}.`);
