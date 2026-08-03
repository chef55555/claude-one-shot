'use strict';

// Names for notable creatures, generated deterministically. The world's
// chronicle refers to a handful of named individuals so its history reads
// like a saga instead of a population census.

const ONSETS = ['Br', 'Kel', 'Mor', 'Thal', 'Ven', 'Or', 'Syl', 'Dun', 'Fen', 'Gal', 'Har', 'Ilm', 'Jor', 'Lun', 'Nim', 'Pell', 'Quill', 'Rook', 'Tam', 'Umber', 'Wren', 'Yar', 'Ash', 'Eld'];
const MIDDLES = ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'ei', 'ia'];
const CODAS = ['rin', 'mek', 'dros', 'fell', 'gorn', 'hoof', 'lisk', 'moss', 'nock', 'pyre', 'reed', 'shard', 'tarn', 'vane', 'whisk', 'brook', 'thorn', 'dusk', 'gleam', 'root'];

const EPITHETS = {
  murl: ['the Grazer', 'Moss-eater', 'of the Shallows', 'the Patient', 'Longwhisker', 'the Wanderer', 'Dune-born', 'the Gentle', 'Swift-hoof', 'the Elder'],
  vyrn: ['the Hunter', 'Sharp-eye', 'of the High Rocks', 'the Silent', 'Storm-chaser', 'the Lean', 'Night-glider', 'the Relentless', 'Red-crest', 'the Old Terror'],
};

function creatureName(rand, species) {
  const name = ONSETS[Math.floor(rand() * ONSETS.length)]
    + MIDDLES[Math.floor(rand() * MIDDLES.length)]
    + CODAS[Math.floor(rand() * CODAS.length)];
  const pool = EPITHETS[species] || EPITHETS.murl;
  const epithet = pool[Math.floor(rand() * pool.length)];
  return `${name} ${epithet}`;
}

const REGION_FLAVOR = ['eastern dunes', 'western shallows', 'high crags', 'mossy lowlands', 'northern reach', 'southern strand', 'drowned valley', 'glimmer coast'];

function regionAt(rand) {
  return REGION_FLAVOR[Math.floor(rand() * REGION_FLAVOR.length)];
}

module.exports = { creatureName, regionAt };
