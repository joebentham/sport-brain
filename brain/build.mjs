// Sport Brain: builds data/today.json from free ESPN endpoints.
// Run: node brain/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const cfg = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));

const now = new Date();
const from = new Date(now.getTime() - cfg.windowDaysBack * 864e5);
const to = new Date(now.getTime() + cfg.windowDaysAhead * 864e5);
const inWindow = (iso) => { const d = new Date(iso); return d >= from && d <= to; };
// ESPN rejects date ranges; whole months work. Cover every month the window touches.
const months = [...new Set([from, now, to].map(d => d.toISOString().slice(0, 7).replace('-', '')))];

const problems = [];
const cache = new Map();
const get = (url) => { if (!cache.has(url)) cache.set(url, fetchJson(url)); return cache.get(url); };
async function fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    problems.push(`${url} -> ${e.message}`);
    return null;
  }
}

const scoreOf = (c) => c?.score == null ? null : (typeof c.score === 'object' ? c.score.displayValue : String(c.score));

function channels(comp) {
  const out = [];
  for (const b of [...(comp.geoBroadcasts || []), ...(comp.broadcasts || [])]) {
    if (b?.media?.shortName) out.push(b.media.shortName);
    for (const n of b?.names || []) out.push(n);
  }
  return [...new Set(out)];
}

// Where to watch. Sources and dates for every rule live in docs/where-to-watch.md.
// channelToService values: a service key, a list of keys (simulcasts, e.g. NBC -> Hulu Live + Peacock),
// or null (a known channel the user cannot get, e.g. another team's regional network).
// leagueFallback "match": a league-name substring, "sport:<sport>", or "team:<display name>" (team rules
// are tried first, so a Knicks game with no listing falls back to MSG rather than the generic NBA rule).
function watchFor(chans, league, sport, editorKeys = null, teams = []) {
  const keys = [];
  for (const ch of chans) for (const k of [cfg.channelToService[ch]].flat()) if (k && !keys.includes(k)) keys.push(k);
  // In-market blackout: when a New York regional network carries the game, the ESPN+ out-of-market feed is blacked out here.
  let note = null;
  const bo = cfg.inMarketBlackout;
  if (bo && chans.some(c => bo.whenChannels.includes(c)) && keys.some(k => bo.dropServices.includes(k))) {
    for (const k of bo.dropServices) { const i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); }
    note = bo.note;
  }
  // Editor-chosen services (manual.json "watchKeys") replace the league fallback rule.
  const picked = Array.isArray(editorKeys) ? editorKeys.filter(k => cfg.services[k] && !keys.includes(k)) : [];
  keys.push(...picked);
  const verified = keys.length > 0;
  if (!verified) {
    const lg = (league || '').toLowerCase();
    const hit = (r) => r.match.startsWith('team:') ? teams.includes(r.match.slice(5))
      : r.match.startsWith('sport:') ? r.match === `sport:${sport}` : lg.includes(r.match);
    const rules = cfg.leagueFallback;
    const rule = rules.find(r => r.match.startsWith('team:') && hit(r)) || rules.find(r => !r.match.startsWith('team:') && hit(r));
    if (rule) { keys.push(...rule.services); note = rule.note || null; }
  }
  // Owned services first, standalone apps ahead of the live-TV bundle.
  const rank = (k) => (cfg.services[k]?.owned ? 0 : cfg.services[k]?.owned === null ? 2 : 4) + (k === 'hulu' ? 1 : 0);
  keys.sort((a, b) => rank(a) - rank(b));
  return {
    channels: chans,
    source: picked.length && keys.length === picked.length ? 'editor' : verified ? 'listing' : (keys.length ? 'league-default' : 'unknown'),
    note,
    options: keys.map(k => ({ key: k, ...cfg.services[k] })),
  };
}

function linksOf(ev) {
  const find = (rel) => (ev.links || []).find(l => l.rel?.includes(rel))?.href || null;
  const gamecast = find('summary'), highlights = find('highlights');
  return gamecast || highlights ? { gamecast, highlights } : null;
}

function normalize(ev, { sport, league, tier, team, feed }) {
  const comp = ev.competitions?.[0];
  if (!comp || !ev.date) return null;
  const cs = comp.competitors || [];
  const home = cs.find(c => c.homeAway === 'home') || cs[0];
  const away = cs.find(c => c.homeAway === 'away') || cs[1];
  const st = comp.status?.type || ev.status?.type || {};
  const lg = ev.league?.name || league;
  return {
    id: `${sport}-${ev.id}`,
    sport, league: lg,
    title: ev.shortName && sport !== 'soccer' && sport !== 'cricket' && sport !== 'rugby' ? ev.name : ev.name,
    detail: sport === 'cricket' ? (ev.description || '').split(',')[0] : null,
    home: home?.team?.displayName, away: away?.team?.displayName,
    homeAbbr: home?.team?.abbreviation || null, awayAbbr: away?.team?.abbreviation || null,
    // Scoreboard path the island app polls for live scores.
    feed: feed || (sport === 'soccer' && ev.league?.slug ? `soccer/${ev.league.slug}` : null),
    start: new Date(ev.date).toISOString(),
    state: st.state || 'pre',
    statusText: comp.status?.summary || st.shortDetail || st.detail || '',
    score: st.state === 'pre' ? null : { home: scoreOf(home), away: scoreOf(away) },
    venue: comp.venue?.fullName || null,
    // Stable per-game ESPN pages taken from the listing itself (no guessed URL patterns).
    links: linksOf(ev),
    preseason: ev.seasonType?.type === 1 || ev.season?.type === 1,
    tier, team: team || null,
    hideScore: tier === 1 && sport === 'soccer' && cfg.hideScoresFor.includes(team),
    watch: watchFor(channels(comp), lg, sport, null, [home?.team?.displayName, away?.team?.displayName].filter(Boolean)),
  };
}

const events = new Map();
const rankOf = (t) => t === 1 ? 0 : t === 2 ? 1 : 2;
const add = (e) => {
  if (!e || !inWindow(e.start)) return;
  const prev = events.get(e.id);
  if (!prev) return events.set(e.id, e);
  // Highest tier wins; keep whichever copy has broadcast info.
  const best = rankOf(prev.tier) <= rankOf(e.tier) ? prev : e, other = best === prev ? e : prev;
  if (!best.watch.options.length && other.watch.options.length) best.watch = other.watch;
  events.set(e.id, best);
};
const teamEvents = new Map(); // tier 1 config entry -> every normalized event found for it, any date
const keepTeam = (t, e) => { if (!e) return; if (!teamEvents.has(t)) teamEvents.set(t, []); teamEvents.get(t).push(e); };
const isTeam = (ev, name) => (ev.competitions?.[0]?.competitors || []).some(c => c.team?.displayName === name);

for (const [tier, list] of [[1, cfg.tier1], [2, cfg.tier2 || []]]) for (const t of list) {
  if (t.kind === 'soccerTeam') {
    for (const q of ['', '?fixture=true']) {
      const j = await get(`${BASE}/soccer/all/teams/${t.teamId}/schedule${q}`);
      for (const ev of j?.events || []) { const e = normalize(ev, { sport: 'soccer', league: 'Football', tier, team: t.name }); add(e); if (tier === 1) keepTeam(t, e); }
    }
  } else if (t.kind === 'teamSchedule') {
    // Off-season: the default schedule may already be next year's regular season, so also ask for preseason games.
    const y = now.getFullYear();
    const qs = tier === 1 ? ['', `?season=${y}&seasontype=1`, `?season=${y + 1}&seasontype=1`] : [''];
    for (const q of qs) {
      const j = await get(`${BASE}/${t.path}/teams/${t.teamId}/schedule${q}`);
      for (const ev of j?.events || []) { const e = normalize(ev, { sport: t.path.split('/')[0], league: t.league, tier, team: t.name, feed: t.path }); add(e); if (tier === 1) keepTeam(t, e); }
    }
  } else if (t.kind === 'cricket') {
    const series = new Map((t.knownSeries || []).map(id => [id, null]));
    const panel = await get(`${BASE}/cricket/scorepanel`);
    for (const s of panel?.scores || []) {
      const lg = s.leagues?.[0];
      if (lg?.id && JSON.stringify(s).includes(`"displayName":"${t.name}"`)) series.set(String(lg.id), lg.name);
    }
    const years = [now.getFullYear(), now.getFullYear() + 1];
    for (const [id, name] of series) for (const m of tier === 1 ? [...months, ...years] : months) {
      const j = await get(`${BASE}/cricket/${id}/scoreboard?dates=${m}`);
      const lname = name || j?.leagues?.[0]?.name || 'Cricket';
      for (const ev of j?.events || []) if (isTeam(ev, t.name)) { const e = normalize(ev, { sport: 'cricket', league: lname, tier, team: t.name, feed: `cricket/${id}` }); add(e); if (tier === 1) keepTeam(t, e); }
    }
  } else if (t.kind === 'rugby') {
    const years = [now.getFullYear(), now.getFullYear() + 1];
    for (const [id, name] of Object.entries(t.leagues)) for (const m of tier === 1 ? [...months, ...years] : months) {
      const j = await get(`${BASE}/rugby/${id}/scoreboard?dates=${m}`);
      for (const ev of j?.events || []) if (isTeam(ev, t.name)) { const e = normalize(ev, { sport: 'rugby', league: name, tier, team: t.name, feed: `rugby/${id}` }); add(e); if (tier === 1) keepTeam(t, e); }
    }
  } // kind "manual" (e.g. a darts player) has no feed; the daily editor adds those to data/manual.json.
}

const soccerTeams = [[1, cfg.tier1], [2, cfg.tier2 || []]].flatMap(([tier, l]) => l.filter(t => t.kind === 'soccerTeam').map(t => ({ tier, name: t.name })));
for (const l of cfg.candidateLeagues) for (const m of months) {
  const j = await get(`${BASE}/${l.path}/scoreboard?dates=${m}&limit=500`);
  for (const ev of j?.events || []) {
    // Team schedules can miss just-finished games; promote any candidate that features one of your football teams.
    const mine = l.path.startsWith('soccer/') && !/women|nwsl/i.test(l.league) && soccerTeams.find(t => isTeam(ev, t.name));
    add(normalize(ev, { sport: l.path.split('/')[0], league: l.league, tier: mine ? mine.tier : 'candidate', team: mine ? mine.name : null, feed: l.path }));
  }
}

// Editorial layer: picks.json promotes candidates and adds a "why" line to anything.
const readJson = async (f, d) => { try { return JSON.parse(await readFile(join(ROOT, 'data', f), 'utf8')); } catch { return d; } };
const picks = await readJson('picks.json', {});
for (const m of await readJson('manual.json', []))
  add({ state: 'pre', statusText: '', score: null, venue: null, team: null, hideScore: false, detail: null, ...m, watch: watchFor([], m.league, m.sport, m.watchKeys) });
const all = [...events.values()].sort((a, b) => a.start.localeCompare(b.start));
for (const e of all) {
  const p = picks[e.id];
  if (!p) continue;
  e.why = p.why || null;
  if (p.tier) { e.pick = p.tier; if (e.tier === 'candidate') e.tier = p.tier; }
}

// "My teams": the next game for each tier 1 team, however far away. Never carries a score or result.
const GAME_HOURS = { cricket: 8, football: 3.5, baseball: 3.5, soccer: 2, rugby: 2, basketball: 2.5, hockey: 2.5 };
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'America/New_York' });
const nextByTeam = cfg.tier1.map(t => {
  const label = t.short || t.name;
  const base = { team: t.name, label, sport: t.kind === 'soccerTeam' ? 'soccer' : t.kind === 'teamSchedule' ? t.path.split('/')[0] : t.kind };
  const seen = new Set();
  const upcoming = (teamEvents.get(t) || []).filter(e => {
    if (seen.has(e.id) || e.state === 'post') return false;
    seen.add(e.id);
    return e.state === 'in' || new Date(e.start) > new Date(now.getTime() - (GAME_HOURS[e.sport] || 3) * 36e5);
  }).sort((a, b) => a.start.localeCompare(b.start));
  const e = upcoming[0];
  if (!e) {
    const note = t.offseason || 'No fixtures listed yet';
    return { ...base, offseason: true, note, text: `${label}: ${note}` };
  }
  const homeIsUs = e.home === t.name;
  const opponent = homeIsUs ? e.away : e.home;
  const g = events.get(e.id) || e; // the board's copy may carry an editor "why" or better broadcast info
  const out = {
    ...base, id: e.id, league: g.league, opponent, opponentAbbr: homeIsUs ? e.awayAbbr : e.homeAbbr, homeAway: homeIsUs ? 'home' : 'away',
    start: e.start, timeTbc: !!g.timeTbc, state: e.state === 'in' ? 'in' : 'pre', feed: e.feed, watch: g.watch, offseason: false,
  };
  if (e.preseason && t.kind === 'teamSchedule') {
    const what = base.sport === 'baseball' ? 'Spring training' : 'Preseason';
    Object.assign(out, { offseason: true, phase: what, note: `${what} from ${dayFmt.format(new Date(e.start))}` });
  } else if (new Date(e.start) - now > 30 * 864e5) {
    Object.assign(out, { offseason: true, phase: 'Off-season', note: `Back ${dayFmt.format(new Date(e.start))}` });
  }
  out.text = out.note ? `${label}: ${out.note.charAt(0).toLowerCase()}${out.note.slice(1)}` : `${label}: ${homeIsUs ? 'v' : 'at'} ${opponent}`;
  return out;
});

// Storylines: one-sentence items written by the editor session (data/stories.json). Missing file = none.
const rawStories = await readJson('stories.json', []);
const stories = (Array.isArray(rawStories) ? rawStories : rawStories?.stories || rawStories?.items || [])
  .filter(s => s && typeof s.text === 'string' && s.text.trim())
  .map(s => ({ text: s.text.trim(), sport: s.sport || null, url: /^https?:\/\//.test(s.url || '') ? s.url : null, source: s.source || null,
    kind: s.kind === 'event' ? 'event' : 'story', spoiler: !!s.spoiler }));

await mkdir(join(ROOT, 'data'), { recursive: true });
const shown = all.filter(e => e.tier !== 'candidate');
const brief = await readJson('brief.json', null);
await writeFile(join(ROOT, 'data', 'today.json'), JSON.stringify({ generatedAt: now.toISOString(), brief, nextByTeam, stories, events: shown, problems }, null, 1));
await writeFile(join(ROOT, 'data', 'candidates.json'), JSON.stringify(all.filter(e => e.tier === 'candidate'), null, 1));

// Calendar feed: Tier 1 plus the editor's picks. Tier 2 stays on the board only.
const LEN = { cricket: 8, football: 3.5, baseball: 3.5, darts: 4, soccer: 2, rugby: 2, basketball: 2.5, hockey: 2.5 };
const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line) => line.match(/.{1,73}/gu).join('\r\n ');
const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sport Brain//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Sport Brain', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
let calCount = 0;
for (const e of shown) {
  if (!(e.tier === 1 || e.pick || e.tier === 'marquee' || e.tier === 'wildcard') || e.state === 'post') continue;
  const start = new Date(e.start), end = new Date(start.getTime() + (LEN[e.sport] || 2.5) * 36e5);
  const owned = e.watch.options.filter(o => o.owned !== false);
  const where = owned.length ? owned.map(o => o.name + (o.owned === null ? '?' : '')).join(' / ')
    : e.watch.options.length ? `Not on your services (${e.watch.options.map(o => o.name).join(', ')})` : 'Where to watch unknown';
  const desc = [e.why, `Watch: ${where}`, e.watch.note, owned[0]?.url].filter(Boolean).join('\n');
  cal.push('BEGIN:VEVENT', `UID:${e.id}@sport-brain`, `DTSTAMP:${stamp(now)}`);
  if (e.timeTbc) cal.push(`DTSTART;VALUE=DATE:${e.start.slice(0, 10).replace(/-/g, '')}`);
  else cal.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
  cal.push(fold(`SUMMARY:${icsEsc((e.tier === 1 ? '★ ' : '') + e.title + (e.detail ? ` (${e.detail})` : ''))}`),
    fold(`DESCRIPTION:${icsEsc(desc)}`), fold(`LOCATION:${icsEsc(where)}`));
  if (owned[0]?.url) cal.push(fold(`URL:${owned[0].url}`));
  if (!e.timeTbc) cal.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, 'TRIGGER:-PT10M', 'END:VALARM');
  cal.push('END:VEVENT');
  calCount++;
}
cal.push('END:VCALENDAR');
await writeFile(join(ROOT, 'data', 'sport-brain.ics'), cal.join('\r\n') + '\r\n');

for (const n of nextByTeam) console.log(`  next: ${n.text}${n.start ? ' ' + n.start.slice(0, 16) : ''}`);
console.log(`${stories.length} stories, ${shown.length} shown, ${all.length - shown.length} candidates, ${calCount} in calendar, ${problems.length} fetch problems`);
for (const p of problems) console.log('  problem:', p);
for (const e of shown) console.log(`  ${e.start.slice(0, 16)}  [${e.tier}${e.pick ? '+' + e.pick : ''}] ${e.title} (${e.league}) ${e.state} -> ${e.watch.options.map(o => o.name).join('/') || '?'}`);
