// Reads data/index.json (written by publish.ps1) and the match files it lists.
const REFRESH_MS = 30000;
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => nf.format(Math.round(n || 0));
const ratio = (a, b) => (b ? a / b : a).toFixed(2);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0) + '%';
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return when(iso);
}

async function getJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const matchCache = new Map();
async function getMatch(file) {
  if (!matchCache.has(file)) matchCache.set(file, getJson(`data/matches/${file}`));
  return matchCache.get(file);
}

// Generic sortable table. columns: [{ key, label, value(row), format?(v, row) }]
function renderTable(table, columns, rows, opts = {}) {
  let sortKey = opts.sortKey ?? columns[1]?.key;
  let desc = true;

  const draw = () => {
    const col = columns.find((c) => c.key === sortKey);
    const sorted = col ? [...rows].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return desc ? -cmp : cmp;
    }) : rows;
    const best = columns.map((c) => (c.highlight && rows.length > 1 ? Math.max(...rows.map(c.value)) : null));

    const head = columns.map((c) =>
      `<th class="${opts.sortable === false ? '' : 'sortable'} ${c.key === sortKey ? 'sorted' : ''}" data-key="${c.key}">${esc(c.label)}${c.key === sortKey ? (desc ? ' ▾' : ' ▴') : ''}</th>`).join('');
    const body = sorted.length
      ? sorted.map((r) => '<tr>' + columns.map((c, i) => {
          const v = c.value(r);
          const isBest = best[i] !== null && v > 0 && v === best[i];
          return `<td class="${isBest ? 'best' : ''}">${c.format ? c.format(v, r) : esc(typeof v === 'number' ? fmt(v) : v)}</td>`;
        }).join('') + '</tr>').join('')
      : `<tr><td colspan="${columns.length}" class="empty">Nothing yet.</td></tr>`;
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;

    if (opts.sortable !== false) {
      table.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
        if (sortKey === th.dataset.key) desc = !desc; else { sortKey = th.dataset.key; desc = true; }
        draw();
      }));
    }
  };
  draw();
}

const gameColumns = [
  { key: 'name', label: 'Player', value: (p) => p.name, format: (v, p) => esc(v) + (p.won ? ' 🏆' : '') },
  { key: 'kills', label: 'Kills', value: (p) => p.stats.kills, highlight: true },
  { key: 'deaths', label: 'Deaths', value: (p) => p.stats.deaths },
  { key: 'kd', label: 'K/D', value: (p) => +ratio(p.stats.kills, p.stats.deaths), format: (v) => v.toFixed(2), highlight: true },
  { key: 'dmg', label: 'Damage', value: (p) => p.stats.damageDealt, highlight: true },
  { key: 'taken', label: 'Taken', value: (p) => p.stats.damageTaken },
  { key: 'blocks', label: 'Blocks', value: (p) => p.stats.blocks, highlight: true },
  { key: 'points', label: 'Points', value: (p) => p.stats.pointsWon, highlight: true },
  { key: 'rounds', label: 'Rounds', value: (p) => p.stats.roundsWon, highlight: true },
];

function pointsHtml(points) {
  return (points || []).map((p) =>
    `<span class="chip ${p.endedRound ? 'round' : ''}" title="${p.endedRound ? 'Won the round' : 'Point'}">${p.number}. ${esc((p.winners || []).join(' & ') || 'draw')}</span>`).join('');
}

function renderLive(live) {
  const section = document.getElementById('live');
  if (!live) { section.hidden = true; return; }
  section.hidden = false;
  document.getElementById('live-meta').textContent =
    `${live.gameMode || 'Game'} · started ${when(live.startedAt)} · updated ${ago(live.updatedAt)} · ${live.points.length} points played`;
  renderTable(document.getElementById('live-table'), gameColumns, live.players, { sortKey: 'kills' });
  document.getElementById('live-points').innerHTML = pointsHtml(live.points);
}

function aggregate(matches) {
  const players = new Map();
  const rivals = new Map();
  const cards = new Map();
  const get = (name) => {
    if (!players.has(name)) players.set(name, { name, games: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, taken: 0, blocks: 0, rounds: 0, points: 0 });
    return players.get(name);
  };

  for (const m of matches) {
    for (const p of m.players) {
      const t = get(p.name);
      t.games++;
      if (p.won) t.wins++;
      t.kills += p.stats.kills;
      t.deaths += p.stats.deaths;
      t.dmg += p.stats.damageDealt;
      t.taken += p.stats.damageTaken;
      t.blocks += p.stats.blocks;
      t.rounds += p.stats.roundsWon;
      t.points += p.stats.pointsWon;
      for (const card of new Set(p.cards || [])) {
        if (!cards.has(card)) cards.set(card, { name: card, held: 0, won: 0 });
        const c = cards.get(card);
        c.held++;
        if (p.won) c.won++;
      }
    }
    for (const k of m.kills || []) {
      if (!k.killer) continue;
      const key = `${k.killer}\u0000${k.victim}`;
      rivals.set(key, (rivals.get(key) || 0) + 1);
    }
  }
  return { players: [...players.values()], rivals, cards: [...cards.values()] };
}

function renderLeaderboard(players) {
  renderTable(document.getElementById('leaderboard'), [
    { key: 'name', label: 'Player', value: (p) => p.name },
    { key: 'wins', label: 'Wins', value: (p) => p.wins, highlight: true },
    { key: 'games', label: 'Games', value: (p) => p.games },
    { key: 'winrate', label: 'Win %', value: (p) => (p.games ? p.wins / p.games : 0), format: (v, p) => pct(p.wins, p.games), highlight: true },
    { key: 'kills', label: 'Kills', value: (p) => p.kills, highlight: true },
    { key: 'deaths', label: 'Deaths', value: (p) => p.deaths },
    { key: 'kd', label: 'K/D', value: (p) => +ratio(p.kills, p.deaths), format: (v) => v.toFixed(2), highlight: true },
    { key: 'dmg', label: 'Damage', value: (p) => p.dmg, highlight: true },
    { key: 'avgdmg', label: 'Dmg / game', value: (p) => (p.games ? p.dmg / p.games : 0), highlight: true },
    { key: 'blocks', label: 'Blocks', value: (p) => p.blocks, highlight: true },
    { key: 'rounds', label: 'Rounds', value: (p) => p.rounds, highlight: true },
  ], players, { sortKey: 'wins' });
}

function renderRivals(players, rivals) {
  const table = document.getElementById('rivals');
  const names = players.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  if (names.length < 2) { table.innerHTML = '<tbody><tr><td class="empty">Needs at least two players.</td></tr></tbody>'; return; }
  const head = '<th></th>' + names.map((n) => `<th>${esc(n)}</th>`).join('');
  const body = names.map((killer) => {
    const counts = names.map((victim) => (killer === victim ? null : rivals.get(`${killer}\u0000${victim}`) || 0));
    const max = Math.max(...counts.filter((c) => c !== null));
    return `<tr><td>${esc(killer)}</td>` + counts.map((c) =>
      c === null ? '<td class="self">—</td>' : `<td class="${c > 0 && c === max ? 'best' : ''}">${fmt(c)}</td>`).join('') + '</tr>';
  }).join('');
  table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
}

function renderCards(cards) {
  renderTable(document.getElementById('cards'), [
    { key: 'name', label: 'Card', value: (c) => c.name },
    { key: 'winrate', label: 'Win %', value: (c) => c.won / c.held, format: (v, c) => pct(c.won, c.held) },
    { key: 'held', label: 'Times held', value: (c) => c.held },
    { key: 'won', label: 'Wins', value: (c) => c.won },
  ], cards.filter((c) => c.held >= 3), { sortKey: 'winrate' });
}

function renderMatches(matches) {
  const root = document.getElementById('matches');
  if (!matches.length) { root.innerHTML = '<p class="empty">No finished games yet.</p>'; return; }
  root.innerHTML = matches.map((m, i) => `
    <details class="match" data-i="${i}">
      <summary>
        <strong>${esc(when(m.endedAt || m.startedAt))}</strong>
        <span class="winner">${esc(m.winners.join(' & ') || 'No winner')}</span>
        <span class="muted">${esc(m.players.map((p) => p.name).join(', '))}</span>
        <span class="muted">${esc(m.gameMode)} · ${dur(m.durationSeconds)} · ${m.points.length} points</span>
      </summary>
      <div class="body"></div>
    </details>`).join('');

  // Fill details lazily on first open.
  root.querySelectorAll('details.match').forEach((d) => d.addEventListener('toggle', () => {
    const body = d.querySelector('.body');
    if (!d.open || body.childElementCount) return;
    const m = matches[+d.dataset.i];
    body.innerHTML = `
      <div class="table-wrap"><table></table></div>
      <h3>Points</h3><div class="points">${pointsHtml(m.points)}</div>
      <h3>Kills</h3>
      <ul class="kills">${(m.kills || []).map((k) =>
        `<li><span class="t">${dur(k.time)}</span>${k.killer ? `<b>${esc(k.killer)}</b> ${esc(k.how)} <b>${esc(k.victim)}</b>` : `<b>${esc(k.victim)}</b> ${esc(k.how)}`}</li>`).join('') || '<li class="empty">None</li>'}</ul>
      ${m.players.some((p) => p.cards && p.cards.length) ? `<h3>Final cards</h3>${m.players.map((p) =>
        `<p><b>${esc(p.name)}:</b> ${esc((p.cards || []).join(', ') || '—')}</p>`).join('')}` : ''}`;
    renderTable(body.querySelector('table'), gameColumns, m.players, { sortKey: 'kills' });
  }));
}

let lastIndex = '';
async function load() {
  let index;
  try {
    index = await getJson('data/index.json');
  } catch {
    document.getElementById('updated').textContent = 'No data published yet.';
    renderMatches([]);
    return;
  }
  document.getElementById('updated').textContent = `Last published ${ago(index.updated)}`;

  let live = null;
  if (index.live) {
    try { live = await getJson('data/live.json'); } catch { /* removed between publishes */ }
  }
  renderLive(live);

  // Only rebuild history when the list of finished matches changes.
  const key = index.matches.join('|');
  if (key === lastIndex) return;
  lastIndex = key;
  const matches = (await Promise.all(index.matches.map((f) => getMatch(f).catch(() => null)))).filter(Boolean);
  const { players, rivals, cards } = aggregate(matches);
  renderLeaderboard(players);
  renderRivals(players, rivals);
  renderCards(cards);
  renderMatches(matches);
}

load();
setInterval(load, REFRESH_MS);
