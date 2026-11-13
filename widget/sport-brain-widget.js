// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: futbol;

// Sport Brain widget for the Scriptable app (https://scriptable.app).
// Shows the game that matters most right now: a live score, or what is next, when, and where to watch it.
// Sizes: small, medium, and Lock Screen (rectangular, inline, circular).
//
// Data: the Sport Brain board's published today.json (rebuilt hourly). For any game that is live or
// about to start, the widget also asks ESPN's public scoreboard for a fresher score.
// iOS decides when widgets refresh, so live scores can be several minutes behind. Tap through for the latest.

const DATA_URL = 'https://joebentham.github.io/sport-brain/data/today.json';
const BOARD_URL = 'https://joebentham.github.io/sport-brain/';
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/';
const CACHE_FILE = 'sport-brain-widget-cache.json';

// ---------------------------------------------------------------------------------------------
// Pure logic (no Scriptable APIs). Kept the same as the web board's rules.
// ---------------------------------------------------------------------------------------------

const EMOJI = { soccer: '⚽️', football: '🏈', cricket: '🏏', rugby: '🏉', darts: '🎯', basketball: '🏀', hockey: '🏒', baseball: '⚾️',
  curling: '🥌', tennis: '🎾', golf: '⛳️', f1: '🏎️', boxing: '🥊', cycling: '🚴', snooker: '🎱', pool: '🎱', motorsport: '🏁',
  nascar: '🏁', indycar: '🏁', motogp: '🏍️', mma: '🥋', ufc: '🥋', skiing: '⛷️', athletics: '🏃', swimming: '🏊', rowing: '🚣',
  sailing: '⛵️', 'horse racing': '🏇', volleyball: '🏐', handball: '🤾', lacrosse: '🥍', chess: '♟️', esports: '🎮' };
// Rough game lengths in hours: after this a game that never reported "in" is no longer treated as live.
const LEN = { cricket: 8, football: 3.5, baseball: 3.5, darts: 9, soccer: 2, rugby: 2, basketball: 2.5, hockey: 2.5 };
// Sports where the away team is written first ("NYJ @ BUF"); everything else is "home v away".
const AWAY_FIRST = ['football', 'basketball', 'hockey', 'baseball'];

const icon = (sport) => EMOJI[String(sport || '').toLowerCase()] || '🏟️';
const isPickish = (e) => !!e.pick || e.tier === 'marquee' || e.tier === 'wildcard';
// 0 = your main teams, 1 = editor's picks, 2 = secondary teams
const rank = (e) => e.tier === 1 ? 0 : isPickish(e) ? 1 : 2;
const gameLenMs = (e) => (LEN[e.sport] || 2.5) * 36e5;

function isLive(e, now) {
  if (e.state === 'in') return true;
  const d = new Date(e.start);
  return e.state === 'pre' && !e.timeTbc && d <= now && now - d < gameLenMs(e);
}

// Same choice as the board's hero card: a live game of yours or a pick, else the next game of yours or a pick,
// else the next anything, else whatever is live. Games with no confirmed time are skipped.
function choose(events, now) {
  const evs = events.filter((e) => !e.timeTbc);
  const live = evs.filter((e) => isLive(e, now)).sort((a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start));
  const upcoming = evs.filter((e) => !isLive(e, now) && e.state !== 'post' && new Date(e.start) > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  const next = upcoming.find((e) => rank(e) < 2) || upcoming[0];
  const top = live.find((e) => rank(e) < 2) || next || live[0] || null;
  // The rest, for the medium widget: other live games first, then recent finals of yours or picks, then what is next.
  const recentFinals = evs.filter((e) => e.state === 'post' && rank(e) < 2 && now - new Date(e.start) < gameLenMs(e) + 36e5)
    .sort((a, b) => b.start.localeCompare(a.start));
  const nextUp = [...upcoming.filter((e) => rank(e) < 2), ...upcoming.filter((e) => rank(e) === 2)]
    .sort((a, b) => a.start.localeCompare(b.start));
  const rest = [...live, ...recentFinals, ...nextUp].filter((e, i, all) => e !== top && all.indexOf(e) === i);
  return { top, rest, live };
}

// ESPN polling: same rule as the board. Live, or due to start within 10 minutes.
function wantsPoll(e, now) {
  if (!e.feed || e.timeTbc || e.state === 'post') return false;
  const d = new Date(e.start);
  return e.state === 'in' || (d - now <= 10 * 6e4 && now - d < gameLenMs(e));
}
const espnId = (e) => String(e.id).slice(String(e.id).indexOf('-') + 1);
const scoreOf = (c) => c == null || c.score == null ? null : (typeof c.score === 'object' ? c.score.displayValue : String(c.score));
function fromBoard(ev) {
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!comp) return null;
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0];
  const away = cs.find((c) => c.homeAway === 'away') || cs[1];
  const st = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
  const state = st.state || 'pre';
  return {
    state,
    statusText: (comp.status && comp.status.summary) || st.shortDetail || st.detail || '',
    score: state === 'pre' ? null : { home: scoreOf(home), away: scoreOf(away) },
  };
}

// Where to watch: the first option you might own (owned true, or null meaning "probably").
const watchOption = (e) => ((e.watch && e.watch.options) || []).find((o) => o.owned !== false) || null;
function watchLabel(e) {
  const o = watchOption(e);
  if (o) return o.owned === null ? `${o.name}?` : o.name;
  return 'Not on your services';
}
const tapUrl = (e) => (e && watchOption(e) && watchOption(e).url) || BOARD_URL;

const hasTeams = (e) => !!(e.home && e.away);
function teamsInOrder(e) {
  if (!hasTeams(e)) return null;
  const awayFirst = AWAY_FIRST.includes(e.sport);
  const a = { name: e.away, abbr: e.awayAbbr || e.away, score: e.score ? e.score.away : null };
  const h = { name: e.home, abbr: e.homeAbbr || e.home, score: e.score ? e.score.home : null };
  return { first: awayFirst ? a : h, second: awayFirst ? h : a, sep: awayFirst ? '@' : 'v' };
}
function shortMatchup(e) {
  const t = teamsInOrder(e);
  return t ? `${t.first.abbr} ${t.sep} ${t.second.abbr}` : (e.title || e.league || 'Game');
}

// The score is shown only when the game allows it. Arsenal men's games (hideScore) never show numbers.
const showsScore = (e) => !e.hideScore && !!e.score && (e.score.home != null || e.score.away != null);

// Phase of a game for display: 'live', 'final' or 'pre'.
function phase(e, now) {
  if (e.state === 'post') return 'final';
  return isLive(e, now) ? 'live' : 'pre';
}

// ESPN's status text ("67'", "2nd 5:32"). Hidden for hideScore games, since some sports put the score in it.
function clockText(e) {
  // Hidden for games ESPN still calls "pre" too: their status text is just the scheduled time.
  if (e.hideScore || e.state === 'pre') return '';
  const s = String(e.statusText || '').trim();
  return /^(final|ft|full time|scheduled)$/i.test(s) ? '' : s;
}

function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
// Times in the phone's own time zone.
const timeText = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayText(d, now) {
  if (sameDay(d, now)) return 'Today';
  const tmrw = new Date(now); tmrw.setDate(now.getDate() + 1);
  if (sameDay(d, tmrw)) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short' });
}
function untilText(d, now) {
  const m = Math.round((d - now) / 6e4);
  if (m < 60) return `in ${Math.max(m, 1)} min`;
  if (m < 24 * 60) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
  return dayText(d, now);
}
// "Today 3:00 PM", "Sat 10:30 AM".
const whenText = (e, now) => `${dayText(new Date(e.start), now)} ${timeText(new Date(e.start))}`;

// One line describing the game's state, safe for hideScore. Used by the list rows and Lock Screen.
function stateLine(e, now) {
  const p = phase(e, now);
  if (p === 'pre') return whenText(e, now);
  const t = teamsInOrder(e);
  const label = p === 'live' ? 'LIVE' : 'Final';
  if (!showsScore(e) || !t) return [label, clockText(e)].filter(Boolean).join(' · ');
  const score = `${t.first.score ?? '–'}–${t.second.score ?? '–'}`;
  return p === 'live' ? [score, clockText(e) || 'LIVE'].join(' · ') : `${score} · Final`;
}

// Next time worth asking iOS to refresh. iOS treats this as "not before", not a schedule.
function nextRefresh(sel, now) {
  const min = (m) => new Date(now.getTime() + m * 6e4);
  if (sel.live.length) return min(5);
  const soon = [sel.top, ...sel.rest].filter((e) => e && e.state === 'pre' && new Date(e.start) > now)
    .map((e) => new Date(e.start)).sort((a, b) => a - b)[0];
  if (soon && soon - now < 30 * 6e4) return new Date(Math.max(min(5).getTime(), soon.getTime() - 6e4));
  return min(30);
}

// The published data is rebuilt hourly; older than three hours means something upstream is stuck.
const isOld = (data, now) => !data || !data.generatedAt || now - new Date(data.generatedAt) > 3 * 36e5;

// ---------------------------------------------------------------------------------------------
// Scriptable side: fetching, caching, drawing.
// ---------------------------------------------------------------------------------------------

const C = {
  bgTop: '#1C1C1E', bgBottom: '#0E0E10', text: '#FFFFFF', secondary: '#8E8E93', tertiary: '#636366',
  red: '#FF453A', green: '#30D158', amber: '#FFD60A', divider: '#2C2C2E',
};
const col = (hex, a) => new Color(hex, a == null ? 1 : a);

async function getJSON(url, timeout) {
  const r = new Request(url);
  r.timeoutInterval = timeout;
  r.headers = { 'Cache-Control': 'no-cache' };
  return await r.loadJSON();
}

function cachePath() {
  const fm = FileManager.local();
  return { fm, path: fm.joinPath(fm.documentsDirectory(), CACHE_FILE) };
}
function readCache() {
  try {
    const { fm, path } = cachePath();
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (_) { return null; }
}
function writeCache(data) {
  try { const { fm, path } = cachePath(); fm.writeString(path, JSON.stringify({ savedAt: new Date().toISOString(), data })); } catch (_) {}
}

// Ask ESPN for fresh state and scores, one request per feed. Failures are ignored: the hourly data stands.
async function refreshLive(events, now) {
  const byFeed = new Map();
  for (const e of events) if (wantsPoll(e, now)) { if (!byFeed.has(e.feed)) byFeed.set(e.feed, []); byFeed.get(e.feed).push(e); }
  let changed = false;
  await Promise.all([...byFeed].map(async ([feed, evs]) => {
    try {
      const j = await getJSON(`${SCOREBOARD}${feed}/scoreboard`, 6);
      const found = new Map(((j && j.events) || []).map((ev) => [String(ev.id), ev]));
      for (const e of evs) {
        const u = fromBoard(found.get(espnId(e)));
        if (u) { Object.assign(e, u); changed = true; }
      }
    } catch (_) {}
  }));
  return changed;
}

async function loadData() {
  try {
    const data = await getJSON(DATA_URL, 10);
    if (!data || !Array.isArray(data.events)) throw new Error('bad data');
    return { data, offline: false };
  } catch (_) {
    const cached = readCache();
    return { data: cached ? cached.data : null, offline: true };
  }
}

// --- drawing helpers

function txt(stack, s, font, color, opts) {
  const t = stack.addText(String(s));
  t.font = font;
  t.textColor = col(color);
  t.lineLimit = (opts && opts.lines) || 1;
  if (opts && opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}
function liveDot(stack, size) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  dc.setFillColor(col(C.red));
  dc.fillEllipse(new Rect(0, 0, size, size));
  const img = stack.addImage(dc.getImage());
  img.imageSize = new Size(size, size);
  return img;
}
function hstack(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function vstack(parent) { const s = parent.addStack(); s.layoutVertically(); return s; }

function baseWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [col(C.bgTop), col(C.bgBottom)];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  return w;
}

function serviceLine(stack, e, size) {
  const o = watchOption(e);
  const color = !o ? C.secondary : o.owned === true ? C.green : C.amber;
  txt(stack, watchLabel(e), Font.semiboldSystemFont(size), color, { scale: 0.7 });
}

function staleLine(stack, info, size) {
  if (!info.stale) return;
  const when = info.generatedAt ? ` · ${timeText(new Date(info.generatedAt))}` : '';
  txt(stack, `⚠︎ Stale${when}`, Font.mediumSystemFont(size), C.amber, { scale: 0.7 });
}

// The main game block, used by small and as the left half of medium.
function heroBlock(parent, e, now) {
  const p = phase(e, now);
  const head = hstack(parent);
  head.spacing = 4;
  txt(head, icon(e.sport), Font.systemFont(13), C.text);
  txt(head, e.league || '', Font.semiboldSystemFont(11), C.secondary, { scale: 0.7 });
  head.addSpacer();
  if (p === 'live') { liveDot(head, 7); txt(head, 'LIVE', Font.boldSystemFont(10), C.red); }
  else if (p === 'final') txt(head, 'Final', Font.semiboldSystemFont(10), C.secondary);

  parent.addSpacer(6);
  const t = teamsInOrder(e);
  if (t) {
    const scored = p !== 'pre' && showsScore(e);
    for (const side of [t.first, t.second]) {
      const row = hstack(parent);
      txt(row, side.name, Font.semiboldSystemFont(15), C.text, { scale: 0.6 });
      if (scored) { row.addSpacer(); txt(row, side.score ?? '–', Font.boldMonospacedSystemFont(17), C.text); }
    }
  } else {
    txt(parent, e.title || e.league || 'Game', Font.semiboldSystemFont(15), C.text, { lines: 2, scale: 0.7 });
  }

  parent.addSpacer(4);
  if (p === 'pre') {
    const d = new Date(e.start);
    txt(parent, timeText(d), Font.semiboldMonospacedSystemFont(20), C.text, { scale: 0.7 });
    txt(parent, sameDay(d, now) ? untilText(d, now) : dayText(d, now), Font.mediumSystemFont(11), C.secondary);
  } else {
    const clock = clockText(e);
    const note = e.hideScore ? 'Score hidden' : clock;
    if (note) txt(parent, note, Font.mediumMonospacedSystemFont(11), p === 'live' ? C.red : C.secondary, { scale: 0.7 });
  }
}

function buildSmall(sel, info, now) {
  const w = baseWidget();
  w.setPadding(14, 14, 12, 14);
  const e = sel.top;
  if (!e) return emptyWidget(w, info);
  w.url = tapUrl(e);
  const col1 = vstack(w);
  heroBlock(col1, e, now);
  w.addSpacer();
  serviceLine(w, e, 11);
  staleLine(w, info, 9);
  return w;
}

function listRow(parent, e, now) {
  const row = vstack(parent);
  row.url = tapUrl(e); // row taps work in medium widgets
  const top = hstack(row);
  top.spacing = 5;
  txt(top, icon(e.sport), Font.systemFont(12), C.text);
  txt(top, shortMatchup(e), Font.semiboldSystemFont(13), C.text, { scale: 0.7 });
  top.addSpacer();
  const p = phase(e, now);
  if (p === 'live') { liveDot(top, 6); }
  const right = p === 'pre' ? timeText(new Date(e.start)) : stateLine(e, now);
  txt(top, right, Font.semiboldMonospacedSystemFont(12), p === 'live' ? C.red : p === 'final' ? C.secondary : C.text, { scale: 0.7 });
  const sub = hstack(row);
  sub.spacing = 4;
  const subText = p === 'pre' && !sameDay(new Date(e.start), now) ? `${dayText(new Date(e.start), now)} · ` : '';
  if (subText) txt(sub, subText, Font.mediumSystemFont(10), C.secondary);
  serviceLine(sub, e, 10);
}

function buildMedium(sel, info, now) {
  const w = baseWidget();
  w.setPadding(14, 14, 12, 14);
  const e = sel.top;
  if (!e) return emptyWidget(w, info);
  w.url = tapUrl(e);
  const body = hstack(w);
  body.topAlignContent();

  const left = vstack(body);
  left.size = new Size(138, 0);
  left.url = tapUrl(e);
  heroBlock(left, e, now);
  left.addSpacer();
  serviceLine(left, e, 11);

  body.addSpacer(10);
  const divider = body.addStack();
  divider.size = new Size(1, 120);
  divider.backgroundColor = col(C.divider);
  body.addSpacer(10);

  const right = vstack(body);
  right.spacing = 7;
  const rows = sel.rest.slice(0, 3);
  if (!rows.length) txt(right, 'Nothing else coming up', Font.mediumSystemFont(12), C.secondary);
  for (const r of rows) listRow(right, r, now);
  right.addSpacer();
  if (info.stale) staleLine(right, info, 9);
  return w;
}

// Lock Screen widgets are drawn by iOS in one tint, so colour is not used here.
function buildRectangular(sel, info, now) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = false;
  w.setPadding(0, 0, 0, 0);
  const e = sel.top;
  if (!e) { txt(w, '🏟️ Sport Brain', Font.semiboldSystemFont(14), C.text); txt(w, 'Nothing scheduled', Font.systemFont(13), C.text); return w; }
  w.url = tapUrl(e);
  const p = phase(e, now);
  txt(w, `${icon(e.sport)} ${shortMatchup(e)}`, Font.semiboldSystemFont(15), C.text, { scale: 0.7 });
  const second = p === 'live' ? `● ${stateLine(e, now)}` : stateLine(e, now);
  txt(w, second, Font.semiboldMonospacedSystemFont(14), C.text, { scale: 0.7 });
  const third = info.stale ? `${watchLabel(e)} · stale` : watchLabel(e);
  const t = txt(w, third, Font.systemFont(12), C.text, { scale: 0.7 });
  t.textOpacity = 0.7;
  return w;
}

function buildInline(sel, info, now) {
  const w = new ListWidget();
  const e = sel.top;
  if (!e) { txt(w, 'Sport Brain: nothing scheduled', Font.systemFont(12), C.text); return w; }
  w.url = tapUrl(e);
  const p = phase(e, now);
  const tail = p === 'pre' ? (sameDay(new Date(e.start), now) ? timeText(new Date(e.start)) : whenText(e, now)) : stateLine(e, now);
  txt(w, `${icon(e.sport)} ${shortMatchup(e)} ${tail}${info.stale ? ' ⚠︎' : ''}`, Font.systemFont(12), C.text);
  return w;
}

function buildCircular(sel, info, now) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = true;
  const e = sel.top;
  if (!e) { txt(w, '🏟️', Font.systemFont(20), C.text); return w; }
  w.url = tapUrl(e);
  const p = phase(e, now);
  const a = txt(w, icon(e.sport), Font.systemFont(16), C.text); a.centerAlignText();
  const line = p === 'pre' ? timeText(new Date(e.start)).replace(/\s?[AP]M$/i, '')
    : p === 'live' ? (showsScore(e) ? stateLine(e, now).split(' · ')[0] : 'LIVE') : 'Final';
  const b = txt(w, line, Font.semiboldMonospacedSystemFont(12), C.text, { scale: 0.6 }); b.centerAlignText();
  return w;
}

function emptyWidget(w, info) {
  w.url = BOARD_URL;
  txt(w, '🏟️ Sport Brain', Font.semiboldSystemFont(14), C.text);
  w.addSpacer(4);
  txt(w, info.noData ? 'No connection yet. Will try again soon.' : 'Nothing on the schedule right now.', Font.systemFont(12), C.secondary, { lines: 3 });
  w.addSpacer();
  staleLine(w, info, 9);
  return w;
}

async function main() {
  const now = new Date();
  const { data, offline } = await loadData();
  const events = data && Array.isArray(data.events) ? data.events : [];
  if (events.length) {
    const changed = await refreshLive(events, now);
    if (!offline || changed) writeCache(data);
  }
  const sel = choose(events, now);
  const info = { stale: !!data && (offline || isOld(data, now)), noData: !data, generatedAt: data && data.generatedAt };

  const family = config.widgetFamily || 'medium';
  const build = { small: buildSmall, medium: buildMedium, large: buildMedium, extraLarge: buildMedium,
    accessoryRectangular: buildRectangular, accessoryInline: buildInline, accessoryCircular: buildCircular }[family] || buildMedium;
  const widget = build(sel, info, now);
  widget.refreshAfterDate = nextRefresh(sel, now);

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium(); // run from the app: show a preview
  Script.complete();
}

// Exposed for testing outside Scriptable. Harmless inside the app.
if (typeof module !== 'undefined' && module) {
  module.exports = { choose, isLive, rank, wantsPoll, espnId, fromBoard, watchLabel, tapUrl, stateLine, showsScore,
    shortMatchup, phase, clockText, nextRefresh, isOld, refreshLive, main };
}

if (typeof ListWidget !== 'undefined' && !(typeof module !== 'undefined' && module && module.__noMain)) await main();
