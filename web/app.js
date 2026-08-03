'use strict';

// Cronterra viewer — a static page that renders whatever world state the
// last GitHub Actions heartbeat committed. No backend calls except static
// JSON files deployed alongside this page.

const TILE = 10;
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const SEASONS = ['Sprouting', 'Deep Summer', 'Emberfall', 'Hushwinter'];
const WEATHER_LABEL = {
  clear: '🌤️ Clear', rain: '☔ Rain', storm: '⛈️ Storm', drought: '🌵 Drought',
  snow: '🌨️ Snow', aurora: '🌌 Aurora', fog: '🌫️ Fog',
};

// Figure out which repo hosts this world, for issue-ops + source links.
function detectRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean);
    if (seg.length) return `${owner}/${seg[0]}`;
  }
  return 'chef55555/claude-one-shot';
}
const REPO = detectRepo();

let live = null;      // latest state
let viewing = null;   // state currently rendered (may be a snapshot)
let snapshots = [];
let isLive = true;
let frame = 0;

// ------------------------------------------------------------- terrain

const terrainCanvas = document.createElement('canvas');

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function terrainColor(e, flora, moisture, sea, snow) {
  if (e <= sea) {
    const depth = e / sea;
    return mix([9, 30, 58], [26, 84, 118], depth * depth);
  }
  if (e < sea + 0.035) return [201, 180, 124]; // sand
  if (e >= snow) return [226, 232, 240];
  const t = (e - sea) / (snow - sea);
  let base = mix([84, 78, 60], [110, 108, 112], t); // soil → rock with altitude
  base = mix(base, [58, 52, 44], (1 - moisture) * 0.25);
  const green = mix([64, 130, 84], [46, 168, 106], flora);
  return mix(base, green, Math.min(1, flora * 1.35));
}

function paintTerrain(state) {
  const { width: W, height: H, seaLevel, snowLevel } = state;
  terrainCanvas.width = W; terrainCanvas.height = H;
  const tctx = terrainCanvas.getContext('2d');
  const img = tctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = terrainColor(state.elevation[i], state.flora[i], state.moisture[i], seaLevel, snowLevel);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------- creatures

function drawCreatures(state) {
  for (const c of state.creatures) {
    const px = c.x * TILE + TILE / 2;
    const py = c.y * TILE + TILE / 2 + Math.sin(frame / 14 + c.id) * 1.2;
    const pulse = 0.75 + 0.25 * Math.sin(frame / 10 + c.id * 1.7);
    if (c.species === 'murl') {
      ctx.fillStyle = `hsla(${c.genome.hue}, 65%, 70%, ${0.9 * pulse})`;
      ctx.shadowColor = `hsl(${c.genome.hue}, 70%, 60%)`;
      ctx.shadowBlur = c.name ? 10 : 4;
      ctx.beginPath();
      ctx.arc(px, py, c.name ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `hsla(${c.genome.hue}, 80%, 62%, ${0.95 * pulse})`;
      ctx.shadowColor = '#ff5a4d';
      ctx.shadowBlur = c.name ? 12 : 6;
      const s = c.name ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

// ------------------------------------------------------------- atmosphere

const drops = Array.from({ length: 130 }, (_, i) => ({
  x: (i * 971) % 960, y: (i * 557) % 640, v: 4 + (i % 5),
}));

function drawWeather(state) {
  const kind = state.weather.kind;
  const Wpx = canvas.width, Hpx = canvas.height;
  if (kind === 'rain' || kind === 'storm') {
    ctx.strokeStyle = kind === 'storm' ? 'rgba(180,200,255,0.5)' : 'rgba(150,180,230,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of drops) {
      d.y += d.v + (kind === 'storm' ? 4 : 0); d.x += kind === 'storm' ? 2.5 : 0.8;
      if (d.y > Hpx) { d.y = -10; d.x = (d.x * 31 + 17) % Wpx; }
      if (d.x > Wpx) d.x -= Wpx;
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 8);
    }
    ctx.stroke();
    if (kind === 'storm' && frame % 180 < 4) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, 0, Wpx, Hpx);
    }
  } else if (kind === 'snow') {
    ctx.fillStyle = 'rgba(240,245,255,0.8)';
    for (const d of drops) {
      d.y += d.v * 0.25; d.x += Math.sin((frame + d.y) / 30) * 0.6;
      if (d.y > Hpx) { d.y = -5; d.x = (d.x * 31 + 17) % Wpx; }
      ctx.fillRect(d.x, d.y, 2, 2);
    }
  } else if (kind === 'fog') {
    for (let i = 0; i < 5; i++) {
      const y = ((frame / 3 + i * 140) % (Hpx + 200)) - 100;
      const grad = ctx.createLinearGradient(0, y - 60, 0, y + 60);
      grad.addColorStop(0, 'rgba(200,210,225,0)');
      grad.addColorStop(0.5, 'rgba(200,210,225,0.13)');
      grad.addColorStop(1, 'rgba(200,210,225,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 60, Wpx, 120);
    }
  } else if (kind === 'aurora') {
    for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (let x = 0; x <= Wpx; x += 12) {
        const y = 70 + band * 46 + Math.sin(x / 90 + frame / 40 + band * 2) * 28;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = band === 1 ? 'rgba(160,120,255,0.28)' : 'rgba(90,230,170,0.3)';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  } else if (kind === 'drought') {
    ctx.fillStyle = 'rgba(255,170,60,0.07)';
    ctx.fillRect(0, 0, Wpx, Hpx);
  }
}

function drawDayNight(state) {
  const hour = state.tick % 24;
  // Darkness peaks at hour 0, vanishes midday.
  const darkness = Math.max(0, Math.cos((hour / 24) * Math.PI * 2)) * 0.45;
  if (darkness > 0.02) {
    ctx.fillStyle = `rgba(8, 12, 38, ${darkness})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // Water shimmer, always.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  const { width: W, height: H, seaLevel } = state;
  for (let i = 0; i < 40; i++) {
    const k = (i * 977 + Math.floor(frame / 6) * 131) % (W * H);
    if (state.elevation[k] <= seaLevel) {
      ctx.fillRect((k % W) * TILE + (i % 5), Math.floor(k / W) * TILE + (i % 7), 4, 1);
    }
  }
}

// ------------------------------------------------------------- HUD & panels

function fmtAge(tick) {
  const days = Math.floor(tick / 24);
  return days > 0 ? `${days}d ${tick % 24}h` : `${tick}h`;
}

function updateHUD(state) {
  const murls = state.creatures.filter((c) => c.species === 'murl').length;
  const vyrns = state.creatures.filter((c) => c.species === 'vyrn').length;
  let flora = 0;
  for (const f of state.flora) flora += f;
  document.getElementById('hud-tick').textContent = fmtAge(state.tick);
  document.getElementById('hud-season').textContent = SEASONS[Math.floor(state.tick / 168) % 4];
  document.getElementById('hud-weather').textContent = WEATHER_LABEL[state.weather.kind] || state.weather.kind;
  document.getElementById('hud-murls').textContent = murls;
  document.getElementById('hud-vyrns').textContent = vyrns;
  document.getElementById('hud-flora').textContent = `${Math.round((flora / (state.width * state.height)) * 100)}%`;

  const legends = document.getElementById('legends');
  const namedAlive = state.creatures.filter((c) => c.name);
  legends.innerHTML = namedAlive.length
    ? namedAlive.map((c) => `<li><span class="legend-dot" style="color:hsl(${c.genome.hue},70%,65%)"></span><span>${esc(c.name)}<br><span class="legend-meta">${c.species} · age ${c.age} ticks</span></span></li>`).join('')
    : '<li class="empty">No living legends right now. Someone will rise.</li>';

  const chron = document.getElementById('chronicle');
  const entries = [...(state.log || [])].reverse().slice(0, 14);
  chron.innerHTML = entries.map((line) => {
    const m = line.match(/^\*\*(.+?)\*\*\s*(·[^—]*)?—?\s*(.*)$/);
    const when = m ? m[1] + (m[2] ? ' ' + m[2].trim() : '') : '';
    const what = m ? m[3] : line;
    return `<div class="chron-entry"><span class="when">${esc(when)}</span><span class="what">${esc(what)}</span></div>`;
  }).join('');

  document.getElementById('footer-status').textContent =
    `Seed ${state.seed} · ${state.stats.births} births · ${state.stats.deaths} deaths · ${state.stats.hunts} hunts · ${state.stats.blessings} blessings granted`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ------------------------------------------------------------- links

function wireLinks() {
  document.getElementById('link-repo').href = `https://github.com/${REPO}/commits`;
  document.getElementById('link-chronicle').href = `https://github.com/${REPO}/blob/main/world/chronicle.md`;
  const bodies = {
    rain: 'I offer this issue so that rain may fall on Cronterra.',
    sun: 'I offer this issue so that the sun may shine on Cronterra.',
    seeds: 'I offer this issue so that seeds may scatter across Cronterra.',
    beasts: 'I offer this issue so that new murls may roam Cronterra.',
    aurora: 'I offer this issue so that an aurora may light the night over Cronterra.',
    meteor: 'I accept responsibility for what is about to happen to Cronterra.',
  };
  document.querySelectorAll('.bless').forEach((a) => {
    const kind = a.dataset.bless;
    a.href = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent('bless: ' + kind)}&body=${encodeURIComponent(bodies[kind])}`;
  });
}

// ------------------------------------------------------------- timeline

async function loadHistory() {
  try {
    const res = await fetch('world/history/index.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    snapshots = data.snapshots || [];
    const scrubber = document.getElementById('scrubber');
    scrubber.max = Math.max(0, snapshots.length - 1);
    scrubber.value = scrubber.max;
  } catch { /* history is optional */ }
}

async function showSnapshot(i) {
  const name = snapshots[i];
  if (!name) return;
  try {
    const res = await fetch(`world/history/${name}`, { cache: 'force-cache' });
    if (!res.ok) return;
    const state = await res.json();
    isLive = false;
    viewing = state;
    paintTerrain(state);
    updateHUD(state);
    const badge = document.getElementById('live-badge');
    badge.textContent = '⏪ PAST';
    badge.classList.add('past');
    document.getElementById('scrub-label').textContent = `tick ${state.tick} · ${fmtAge(state.tick)} old`;
  } catch { /* ignore fetch hiccups while scrubbing */ }
}

function goLive() {
  if (!live) return;
  isLive = true;
  viewing = live;
  paintTerrain(live);
  updateHUD(live);
  const badge = document.getElementById('live-badge');
  badge.textContent = '● LIVE';
  badge.classList.remove('past');
  document.getElementById('scrub-label').textContent = 'present';
  const scrubber = document.getElementById('scrubber');
  scrubber.value = scrubber.max;
}

// ------------------------------------------------------------- boot

async function loadLive() {
  const res = await fetch('world/state.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`state.json ${res.status}`);
  live = await res.json();
  if (isLive) {
    viewing = live;
    paintTerrain(live);
    updateHUD(live);
  }
}

function loop() {
  frame++;
  if (viewing) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainCanvas, 0, 0, canvas.width, canvas.height);
    drawCreatures(viewing);
    drawDayNight(viewing);
    drawWeather(viewing);
  }
  requestAnimationFrame(loop);
}

(async function boot() {
  wireLinks();
  try {
    await loadLive();
    await loadHistory();
    goLive();
  } catch (err) {
    document.getElementById('footer-status').textContent =
      'Could not load the world state — the first heartbeat may not have run yet. (' + err.message + ')';
  }
  document.getElementById('scrubber').addEventListener('input', (e) => showSnapshot(+e.target.value));
  document.getElementById('btn-live').addEventListener('click', goLive);
  // The world only changes when a workflow commits, so a lazy poll is plenty.
  setInterval(() => { if (isLive) loadLive().catch(() => {}); }, 5 * 60 * 1000);
  loop();
})();
