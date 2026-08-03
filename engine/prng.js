'use strict';

// Deterministic PRNG toolkit. The whole simulation must be reproducible from
// (seed string, tick number) alone — no Date.now(), no Math.random().

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(seed, ...salts) {
  return mulberry32(hashString(seed + '::' + salts.join('::')));
}

// Smooth 2D value noise built on the seeded PRNG (used for terrain genesis).
function makeNoise2D(seed, salt) {
  const cache = new Map();
  function lattice(ix, iy) {
    const key = ix + ',' + iy;
    if (!cache.has(key)) cache.set(key, rngFor(seed, salt, ix, iy)());
    return cache.get(key);
  }
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }
  return function (x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(noise, x, y, octaves) {
  let value = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

module.exports = { hashString, mulberry32, rngFor, makeNoise2D, fbm };
