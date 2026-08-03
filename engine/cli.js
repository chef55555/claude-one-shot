#!/usr/bin/env node
'use strict';

// CLI harness the GitHub Actions workflows drive. Zero dependencies.
//
//   node engine/cli.js genesis [--seed=<string>]
//   node engine/cli.js tick [--count=N] [--bless=rain|sun|seeds|beasts|aurora|meteor]
//   node engine/cli.js status

const fs = require('fs');
const path = require('path');
const { genesis, tick, seasonOf, dayOfSeason, WEATHER } = require('./world');

const ROOT = path.join(__dirname, '..');
const WORLD_DIR = path.join(ROOT, 'world');
const HISTORY_DIR = path.join(WORLD_DIR, 'history');
const STATE_PATH = path.join(WORLD_DIR, 'state.json');
const CHRONICLE_PATH = path.join(WORLD_DIR, 'chronicle.md');
const HISTORY_KEEP = 168; // one real-time week of hourly snapshots

const BLESSINGS = ['rain', 'sun', 'seeds', 'beasts', 'aurora', 'meteor'];

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    console.error('No world exists yet. Run: node engine/cli.js genesis');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

function snapshot(state) {
  const name = `tick-${String(state.tick).padStart(6, '0')}.json`;
  fs.writeFileSync(path.join(HISTORY_DIR, name), JSON.stringify(state));
  const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.startsWith('tick-')).sort();
  while (files.length > HISTORY_KEEP) fs.unlinkSync(path.join(HISTORY_DIR, files.shift()));
  fs.writeFileSync(path.join(HISTORY_DIR, 'index.json'), JSON.stringify({ snapshots: files }));
}

function appendChronicle(lines) {
  if (!lines.length) return;
  fs.appendFileSync(CHRONICLE_PATH, lines.map((l) => `${l}\n\n`).join(''));
}

function emitOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value.replace(/\n/g, ' ')}\n`);
  }
}

function summarize(state) {
  const murls = state.creatures.filter((c) => c.species === 'murl').length;
  const vyrns = state.creatures.filter((c) => c.species === 'vyrn').length;
  const w = WEATHER[state.weather.kind];
  return `tick ${state.tick} · Day ${dayOfSeason(state.tick)} of ${seasonOf(state.tick)} · ${w.label} · ${murls} murls, ${vyrns} vyrn`;
}

const cmd = process.argv[2];

if (cmd === 'genesis') {
  if (fs.existsSync(STATE_PATH) && arg('force', '') !== 'true') {
    console.error('A world already exists. Refusing to overwrite it (pass --force=true to raze it).');
    process.exit(1);
  }
  const seed = arg('seed', process.env.GITHUB_SHA || 'cronterra-prime');
  const state = genesis(seed);
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(CHRONICLE_PATH, `# 📜 The Chronicle of Cronterra\n\n*A history written by the world itself, one GitHub Actions run at a time. Seed: \`${seed}\`*\n\n${state.log[0]}\n\n`);
  saveState(state);
  snapshot(state);
  console.log(`🌍 Genesis complete. ${summarize(state)}`);
  emitOutput('headline', 'Genesis — a world grew from the seed');
} else if (cmd === 'tick') {
  const count = Math.max(1, Math.min(1000, parseInt(arg('count', '1'), 10) || 1));
  const bless = arg('bless', '');
  if (bless && !BLESSINGS.includes(bless)) {
    console.error(`Unknown blessing "${bless}". Known: ${BLESSINGS.join(', ')}`);
    process.exit(1);
  }
  let state = loadState();
  const newLines = [];
  let lastHeadline = '';
  for (let i = 0; i < count; i++) {
    const res = tick(state, i === 0 ? bless || null : null);
    state = res.state;
    if (res.chronicleLine) newLines.push(res.chronicleLine);
    lastHeadline = res.headline;
  }
  saveState(state);
  snapshot(state);
  appendChronicle(newLines);
  console.log(`⏳ Advanced ${count} tick(s). ${summarize(state)}`);
  if (newLines.length) console.log(newLines[newLines.length - 1]);
  emitOutput('headline', lastHeadline.replace(/\*/g, ''));
  emitOutput('tick', String(state.tick));
} else if (cmd === 'status') {
  const state = loadState();
  console.log(summarize(state));
  console.log(`stats: ${JSON.stringify(state.stats)}`);
} else {
  console.error('Usage: node engine/cli.js <genesis|tick|status> [--seed=] [--count=] [--bless=]');
  process.exit(1);
}
