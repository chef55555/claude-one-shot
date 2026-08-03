'use strict';

// Cronterra world engine. Pure and deterministic: the same seed and tick
// number always produce the same world, so the git history of state.json
// is a faithful, replayable timeline of everything that ever happened.

const { rngFor, makeNoise2D, fbm } = require('./prng');
const { creatureName, regionAt } = require('./namegen');

const W = 96;
const H = 64;
const SEA_LEVEL = 0.40;
const SNOW_LEVEL = 0.82;
const HOURS_PER_DAY = 24;
const DAYS_PER_SEASON = 7;
const SEASON_LEN = HOURS_PER_DAY * DAYS_PER_SEASON;
const SEASONS = ['Sprouting', 'Deep Summer', 'Emberfall', 'Hushwinter'];
const SEASON_EMOJI = ['🌱', '☀️', '🍂', '❄️'];
const MAX_CREATURES = 420;
const MAX_NAMED = 7;

const WEATHER = {
  clear:   { emoji: '🌤️', label: 'Clear skies' },
  rain:    { emoji: '☔', label: 'Rainfall' },
  storm:   { emoji: '⛈️', label: 'Storm' },
  drought: { emoji: '🌵', label: 'Drought' },
  snow:    { emoji: '🌨️', label: 'Snowfall' },
  aurora:  { emoji: '🌌', label: 'Aurora' },
  fog:     { emoji: '🌫️', label: 'Fog' },
};

const idx = (x, y) => y * W + x;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

function seasonOf(tick) {
  return SEASONS[Math.floor(tick / SEASON_LEN) % 4];
}
function seasonIndex(tick) {
  return Math.floor(tick / SEASON_LEN) % 4;
}
function dayOfSeason(tick) {
  return Math.floor((tick % SEASON_LEN) / HOURS_PER_DAY) + 1;
}
function hourOfDay(tick) {
  return tick % HOURS_PER_DAY;
}

// ---------------------------------------------------------------- genesis

function genesis(seed) {
  const elevNoise = makeNoise2D(seed, 'elev');
  const moistNoise = makeNoise2D(seed, 'moist');
  const elevation = new Array(W * H);
  const moisture = new Array(W * H);
  const flora = new Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H;
      // Radial falloff pulls the edges underwater so the world is an island
      // chain rather than an endless plain.
      const dx = nx - 0.5, dy = ny - 0.5;
      const falloff = 1 - clamp(Math.sqrt(dx * dx + dy * dy) * 1.9 - 0.25, 0, 1);
      let e = fbm(elevNoise, nx * 5, ny * 5, 5);
      e = clamp(e * 0.75 + falloff * 0.45 - 0.08, 0, 1);
      elevation[idx(x, y)] = e;
      const m = clamp(fbm(moistNoise, nx * 4 + 9, ny * 4 + 9, 4) * 1.15, 0, 1);
      moisture[idx(x, y)] = e <= SEA_LEVEL ? 1 : m;
      flora[idx(x, y)] = e > SEA_LEVEL && e < SNOW_LEVEL ? clamp(m * 0.8 - 0.1, 0, 1) : 0;
    }
  }

  const rand = rngFor(seed, 'genesis-life');
  const creatures = [];
  let nextId = 1;
  const spawnOnLand = (species, energy) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
      if (elevation[idx(x, y)] > SEA_LEVEL && elevation[idx(x, y)] < SNOW_LEVEL) {
        creatures.push({
          id: nextId++, species, x, y, energy, age: 0,
          genome: {
            speed: round2(0.6 + rand() * 0.8),
            metabolism: round2(0.8 + rand() * 0.5),
            hue: Math.floor(rand() * 360),
          },
        });
        return;
      }
    }
  };
  for (let i = 0; i < 30; i++) spawnOnLand('murl', 14 + rand() * 8);
  for (let i = 0; i < 6; i++) spawnOnLand('vyrn', 22 + rand() * 8);

  return {
    name: 'Cronterra',
    seed,
    tick: 0,
    width: W,
    height: H,
    seaLevel: SEA_LEVEL,
    snowLevel: SNOW_LEVEL,
    elevation: elevation.map(round3),
    moisture: moisture.map(round2),
    flora: flora.map(round2),
    creatures,
    nextId,
    weather: { kind: 'clear', ttl: 6 },
    named: {},
    stats: { births: 0, deaths: 0, hunts: 0, blessings: 0, meteors: 0 },
    log: ['**Tick 00000** · Genesis — In the beginning there was only the seed, and the seed was a hash. Land rose from the noise, moss took the lowlands, and the first murls opened their eyes.'],
  };
}

// ------------------------------------------------------------------ tick

function pickWeather(rand, sIdx, hour) {
  const night = hour < 6 || hour >= 20;
  const roll = rand();
  if (night && roll > 0.965) return 'aurora';
  const tables = [
    // [clear, rain, storm, drought, snow, fog] cumulative weights per season
    [0.45, 0.80, 0.88, 0.90, 0.90, 1.0], // Sprouting: wet
    [0.55, 0.72, 0.80, 0.95, 0.95, 1.0], // Deep Summer: droughts
    [0.45, 0.70, 0.85, 0.88, 0.90, 1.0], // Emberfall: stormy
    [0.35, 0.45, 0.52, 0.54, 0.92, 1.0], // Hushwinter: snow
  ];
  const t = tables[sIdx];
  const kinds = ['clear', 'rain', 'storm', 'drought', 'snow', 'fog'];
  for (let i = 0; i < kinds.length; i++) if (roll <= t[i]) return kinds[i];
  return 'clear';
}

function neighborsOf(x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push([nx, ny]);
    }
  }
  return out;
}

function tick(state, blessing) {
  const t = state.tick + 1;
  const rand = rngFor(state.seed, 'tick', t);
  const sIdx = seasonIndex(t);
  const hour = hourOfDay(t);
  const events = [];
  const elevation = state.elevation;
  const moisture = state.moisture.slice();
  const flora = state.flora.slice();
  const stats = { ...state.stats };
  const named = { ...state.named };

  // --- blessings (issue-ops offerings from the outside world) ------------
  let weather = { ...state.weather };
  if (blessing) {
    stats.blessings++;
    if (blessing === 'rain') {
      weather = { kind: 'rain', ttl: 10 };
      events.push('An offering was made beyond the sky, and the clouds obeyed: rain, summoned by a stranger’s kindness.');
    } else if (blessing === 'sun') {
      weather = { kind: 'clear', ttl: 12 };
      events.push('A blessing of sun burned the sky clean. The moss stretched toward the warmth.');
    } else if (blessing === 'seeds') {
      for (let i = 0; i < 220; i++) {
        const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
        const k = idx(x, y);
        if (elevation[k] > SEA_LEVEL && elevation[k] < SNOW_LEVEL) flora[k] = clamp(flora[k] + 0.35, 0, 1);
      }
      events.push('Seeds fell from beyond the fog — a gift from an unseen gardener. Green freckles spread across the land.');
    } else if (blessing === 'beasts') {
      for (let i = 0; i < 6; i++) spawnMigrant(state, flora, rand, 'murl');
      events.push('Six young murls wandered in from beyond the edge of the map, sent by someone who cared.');
    } else if (blessing === 'aurora') {
      weather = { kind: 'aurora', ttl: 8 };
      events.push('The sky was blessed with an aurora. Every creature stopped to watch. Even the vyrn.');
    } else if (blessing === 'meteor') {
      stats.meteors++;
      const cx = 8 + Math.floor(rand() * (W - 16)), cy = 8 + Math.floor(rand() * (H - 16));
      const r = 6;
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d <= r) {
            const k = idx(x, y);
            flora[k] = 0;
            moisture[k] = clamp(moisture[k] - 0.5, 0, 1);
          }
        }
      }
      const casualties = state.creatures.filter((c) => Math.hypot(c.x - cx, c.y - cy) <= r);
      for (const c of casualties) c.energy = -999;
      events.push(`A meteor screamed down over the ${regionAt(rand)} and left a scorched crater. ${casualties.length ? casualties.length + ' creature(s) never saw it coming.' : 'Miraculously, nothing was standing there.'}`);
    }
  }

  // --- weather machine ---------------------------------------------------
  weather.ttl -= 1;
  if (weather.ttl <= 0) {
    const prev = weather.kind;
    const kind = pickWeather(rand, sIdx, hour);
    weather = { kind, ttl: 3 + Math.floor(rand() * 8) };
    if (kind !== prev) {
      const lines = {
        rain: 'Clouds gathered and the rain began, drumming softly on the moss.',
        storm: 'A storm rolled in off the water. The murls huddled in the lee of the crags.',
        drought: 'The air went dry and mean. A drought settled over the land.',
        snow: 'Snow began to fall, slow and absolute, hushing the whole world.',
        aurora: 'An aurora unfurled across the night — green fire in silence.',
        fog: 'Fog crept up from the shallows until the world was a rumor of itself.',
        clear: 'The sky cleared. Light returned to the lowlands.',
      };
      if (rand() < 0.8) events.push(lines[kind]);
    }
  }

  // --- hydrology & flora -------------------------------------------------
  const wk = weather.kind;
  const seasonGrowth = [1.25, 1.0, 0.8, 0.35][sIdx];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = idx(x, y);
      if (elevation[k] <= SEA_LEVEL) { moisture[k] = 1; continue; }
      let m = moisture[k];
      if (wk === 'rain') m += 0.06;
      else if (wk === 'storm') m += 0.10;
      else if (wk === 'snow') m += 0.02;
      else if (wk === 'drought') m -= 0.07;
      else m -= 0.012;
      // Coastal tiles wick moisture from the sea.
      for (const [nx, ny] of neighborsOf(x, y)) {
        if (elevation[idx(nx, ny)] <= SEA_LEVEL) { m += 0.008; break; }
      }
      moisture[k] = clamp(m, 0.02, 1);

      if (elevation[k] < SNOW_LEVEL) {
        let f = flora[k];
        let growth = 0.016 * seasonGrowth * moisture[k];
        if (wk === 'snow') growth *= 0.15;
        if (wk === 'storm') growth *= 0.6;
        f += growth * (1 - f);
        if (moisture[k] < 0.15) f -= 0.03; // parched moss dies back
        flora[k] = clamp(f, 0, 1);
      }
    }
  }
  // Spore spread: healthy moss colonizes bare neighbors (sparse sampling
  // keeps the tick cheap and adds organic raggedness to the frontier).
  for (let i = 0; i < 500; i++) {
    const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
    const k = idx(x, y);
    if (flora[k] > 0.55) {
      const nbs = neighborsOf(x, y);
      const [nx, ny] = nbs[Math.floor(rand() * nbs.length)];
      const nk = idx(nx, ny);
      if (elevation[nk] > SEA_LEVEL && elevation[nk] < SNOW_LEVEL && flora[nk] < 0.3) {
        flora[nk] = clamp(flora[nk] + 0.08, 0, 1);
      }
    }
  }

  // --- creatures ---------------------------------------------------------
  const creatures = state.creatures;
  let nextId = state.nextId;
  const births = [];
  const isLand = (x, y) => elevation[idx(x, y)] > SEA_LEVEL;
  const slowWorld = wk === 'storm' || wk === 'snow';

  for (const c of creatures) {
    if (c.energy <= -900) continue; // meteor casualty, already doomed
    c.age++;
    c.energy -= 0.55 * c.genome.metabolism * (slowWorld ? 0.8 : 1);

    const steps = rand() < c.genome.speed ? 1 : 0;
    if (c.species === 'murl') {
      const here = idx(c.x, c.y);
      if (flora[here] > 0.12) {
        const bite = Math.min(flora[here], 0.22);
        flora[here] -= bite;
        c.energy += bite * 16;
      } else if (steps) {
        // Drift toward the greenest neighboring tile.
        let best = null, bestF = -1;
        for (const [nx, ny] of neighborsOf(c.x, c.y)) {
          if (!isLand(nx, ny)) continue;
          const f = flora[idx(nx, ny)] + rand() * 0.05;
          if (f > bestF) { bestF = f; best = [nx, ny]; }
        }
        if (best) { c.x = best[0]; c.y = best[1]; }
      }
      if (c.energy > 30 && creatures.length + births.length < MAX_CREATURES && rand() < 0.25) {
        c.energy -= 12;
        births.push(child(c, nextId++, rand));
      }
    } else { // vyrn: hunt the nearest murl within scent range
      let prey = null, bestD = 81;
      for (const p of creatures) {
        if (p.species !== 'murl' || p.energy <= 0) continue;
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < bestD) { bestD = d; prey = p; }
      }
      if (prey && steps) {
        c.x = clamp(c.x + Math.sign(prey.x - c.x), 0, W - 1);
        c.y = clamp(c.y + Math.sign(prey.y - c.y), 0, H - 1);
        if (c.x === prey.x && c.y === prey.y) {
          prey.energy = 0;
          prey.hunted = true;
          c.energy += 14;
          stats.hunts++;
        }
      } else if (steps) {
        const nbs = neighborsOf(c.x, c.y).filter(([nx, ny]) => isLand(nx, ny));
        if (nbs.length) { const [nx, ny] = nbs[Math.floor(rand() * nbs.length)]; c.x = nx; c.y = ny; }
      }
      if (c.energy > 42 && creatures.length + births.length < MAX_CREATURES && rand() < 0.12) {
        c.energy -= 18;
        births.push(child(c, nextId++, rand));
      }
    }
  }

  // Deaths, with eulogies for the named.
  const maxAge = (c) => (c.species === 'murl' ? 260 : 420);
  const survivors = [];
  for (const c of creatures) {
    const dead = c.energy <= 0 || c.age > maxAge(c);
    if (!dead) { survivors.push(c); continue; }
    stats.deaths++;
    if (c.name) {
      delete named[c.id];
      const cause = c.energy <= -900 ? 'was taken by the meteor' : c.hunted ? 'fell to a vyrn’s patience' : c.age > maxAge(c) ? `died old and full of years, aged ${c.age} ticks` : 'starved when the moss ran thin';
      events.push(`${c.name} ${cause}. The ${regionAt(rand)} will remember.`);
    }
  }
  stats.births += births.length;
  survivors.push(...births);

  // --- extinction failsafes: the world must never fully die --------------
  const murls = survivors.filter((c) => c.species === 'murl').length;
  const vyrns = survivors.filter((c) => c.species === 'vyrn').length;
  if (murls < 4) {
    for (let i = 0; i < 8; i++) spawnMigrantInto(survivors, () => nextId++, elevation, flora, rand, 'murl');
    events.push('The murls had all but vanished — then a small herd wandered in from beyond the fog, as if the world refused to be empty.');
  }
  if (vyrns < 1 && murls > 40 && rand() < 0.3) {
    for (let i = 0; i < 2; i++) spawnMigrantInto(survivors, () => nextId++, elevation, flora, rand, 'vyrn');
    events.push('With the herds grown fat and fearless, new vyrn slipped ashore in the night. Balance, of a kind.');
  }
  let totalFlora = 0;
  for (const f of flora) totalFlora += f;
  if (totalFlora < 120) {
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
      const k = idx(x, y);
      if (elevation[k] > SEA_LEVEL && elevation[k] < SNOW_LEVEL) flora[k] = clamp(flora[k] + 0.3, 0, 1);
    }
    events.push('The land lay nearly barren, until spores rode in on the wind and the green began again.');
  }

  // --- name a new legend occasionally ------------------------------------
  if (Object.keys(named).length < MAX_NAMED && rand() < 0.10) {
    const unnamed = survivors.filter((c) => !c.name && c.age > 20);
    if (unnamed.length) {
      unnamed.sort((a, b) => b.age - a.age);
      const chosen = unnamed[0];
      chosen.name = creatureName(rand, chosen.species);
      named[chosen.id] = chosen.name;
      events.push(`The other ${chosen.species}s began to follow one of their own — the one now called ${chosen.name}.`);
    }
  }

  // --- population milestones --------------------------------------------
  if (murls + births.length > 0 && (murls >= 200 && state.creatures.filter((c) => c.species === 'murl').length < 200)) {
    events.push('The murl herds now number two hundred strong — the greatest gathering the world has known.');
  }
  if (t % SEASON_LEN === 0) {
    events.push(`${SEASON_EMOJI[sIdx]} The season turned. ${seasonOf(t)} settled over Cronterra.`);
  }

  const w = WEATHER[weather.kind];
  const headline = `**Tick ${String(t).padStart(5, '0')}** · Day ${dayOfSeason(t)} of ${seasonOf(t)} · ${w.emoji} ${w.label}`;
  const line = events.length ? `${headline} — ${events.join(' ')}` : null;

  const next = {
    ...state,
    tick: t,
    moisture: moisture.map(round2),
    flora: flora.map(round2),
    creatures: survivors.map((c) => ({ ...c, energy: round2(c.energy) })),
    nextId,
    weather,
    named,
    stats,
    log: line ? [...state.log, line].slice(-40) : state.log,
  };
  return { state: next, chronicleLine: line, headline: events[0] || `${w.emoji} ${w.label} over Cronterra` };
}

function child(parent, id, rand) {
  const mut = (v, amt, lo, hi) => clamp(round2(v + (rand() - 0.5) * amt), lo, hi);
  return {
    id,
    species: parent.species,
    x: parent.x,
    y: parent.y,
    energy: parent.species === 'murl' ? 10 : 16,
    age: 0,
    genome: {
      speed: mut(parent.genome.speed, 0.2, 0.3, 1.4),
      metabolism: mut(parent.genome.metabolism, 0.15, 0.5, 1.5),
      hue: (parent.genome.hue + Math.floor((rand() - 0.5) * 40) + 360) % 360,
    },
  };
}

function spawnMigrant(state, flora, rand, species) {
  spawnMigrantInto(state.creatures, () => state.nextId++, state.elevation, flora, rand, species);
}

function spawnMigrantInto(list, takeId, elevation, flora, rand, species) {
  for (let tries = 0; tries < 200; tries++) {
    const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
    const k = idx(x, y);
    if (elevation[k] > SEA_LEVEL && elevation[k] < SNOW_LEVEL) {
      list.push({
        id: takeId(), species, x, y,
        energy: species === 'murl' ? 16 : 24, age: 0,
        genome: {
          speed: round2(0.6 + rand() * 0.8),
          metabolism: round2(0.8 + rand() * 0.5),
          hue: Math.floor(rand() * 360),
        },
      });
      return;
    }
  }
}

module.exports = { genesis, tick, seasonOf, dayOfSeason, hourOfDay, WEATHER, W, H };
