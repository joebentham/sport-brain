// Draws the morning brief as an image card (SVG), attached to the ntfy notification.
// Spoiler recaps are drawn as their label only, same as the text.
const W = 1080, PAD = 64;
const C = { bg: '#0f1720', panel: '#17222e', text: '#eef2f6', dim: '#8a9aab', accent: '#5fd1a4', rule: '#26323f' };
const SPORT = { soccer: ['Football', '#4caf7a'], football: ['NFL', '#d9822b'], cricket: ['Cricket', '#c9a227'],
  rugby: ['Rugby', '#9b6bd3'], basketball: ['NBA', '#e0673b'], hockey: ['NHL', '#4a90d9'], darts: ['Darts', '#d64550'],
  curling: ['Curling', '#5fb7c9'], baseball: ['MLB', '#3f7fd1'], tennis: ['Tennis', '#a5c93c'], golf: ['Golf', '#3fa86b'] };
const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Rough wrap: average glyph width is about 0.52em for these fonts.
function wrap(text, size, width) {
  const max = Math.floor(width / (size * 0.52));
  const lines = []; let cur = '';
  for (const word of String(text).split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > max) { lines.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function cardSvg(b, sportOf = () => null) {
  const out = []; let y = PAD;
  const day = new Date(`${b.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  out.push(`<text x="${PAD}" y="${y + 26}" font-size="26" fill="${C.accent}" font-weight="600" letter-spacing="2">${esc(day.toUpperCase())}</text>`);
  y += 56;
  for (const l of wrap(b.headline || 'Today in sport', 50, W - PAD * 2)) {
    y += 58; out.push(`<text x="${PAD}" y="${y}" font-size="50" font-weight="700" fill="${C.text}">${esc(l)}</text>`);
  }
  y += 30;

  const heading = t => { y += 50; out.push(`<text x="${PAD}" y="${y}" font-size="24" font-weight="700" fill="${C.dim}" letter-spacing="3">${t}</text>`); y += 18; };
  const pill = (sport, x, yy) => {
    const s = SPORT[sport]; if (!s) return 0;
    const w = s[0].length * 14 + 28;
    out.push(`<rect x="${x}" y="${yy - 26}" width="${w}" height="36" rx="18" fill="${s[1]}" opacity="0.22"/>`,
      `<text x="${x + w / 2}" y="${yy - 2}" font-size="22" font-weight="700" fill="${s[1]}" text-anchor="middle">${s[0]}</text>`);
    return w;
  };

  if (b.today?.length) {
    heading('TODAY');
    for (const line of b.today) {
      const m = line.match(/^(\d{1,2}:\d{2}\s*[AP]M):\s*(.*)$/i);
      const time = m ? m[1] : '', rest = m ? m[2] : line;
      const top = y + 14, textX = PAD + 210;
      const lines = wrap(rest, 34, W - textX - PAD);
      const sport = SPORT[sportOf(line)] ? sportOf(line) : null;
      const last = top + 62 + (lines.length - 1) * 44;
      const h = (sport ? last + 58 + 24 : last + 32) - top;
      out.push(`<rect x="${PAD}" y="${top}" width="${W - PAD * 2}" height="${h}" rx="22" fill="${C.panel}"/>`);
      out.push(`<text x="${PAD + 28}" y="${top + 62}" font-size="34" font-weight="700" fill="${C.accent}">${esc(time)}</text>`);
      lines.forEach((l, i) => out.push(`<text x="${textX}" y="${top + 62 + i * 44}" font-size="34" fill="${C.text}">${esc(l)}</text>`));
      if (sport) pill(sport, textX, last + 58);
      y = top + h;
    }
  }

  const para = (text, color = C.text, size = 32) => {
    for (const l of wrap(text, size, W - PAD * 2)) { y += size + 12; out.push(`<text x="${PAD}" y="${y}" font-size="${size}" fill="${color}">${esc(l)}</text>`); }
    y += 20;
  };
  if (b.recaps?.length) {
    heading('YESTERDAY');
    for (const r of b.recaps) para(r.spoiler ? `${r.label || 'Result'}: hidden to avoid spoilers` : r.text, r.spoiler ? C.dim : C.text);
  }
  if (b.lookAhead) { heading('COMING UP'); para(b.lookAhead); }
  y += PAD - 10;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="${FONT}">` +
    `<rect width="${W}" height="${y}" fill="${C.bg}"/>${out.join('')}</svg>`;
}

export async function cardPng(b, sportOf) {
  const { Resvg } = await import('@resvg/resvg-js');
  return new Resvg(cardSvg(b, sportOf), { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng();
}
