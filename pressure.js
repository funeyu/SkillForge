(function (root) {
  'use strict';

  function countCharacters(text) {
    let count = 0;
    for (const character of text || '') {
      if (!/\s/u.test(character)) count += 1;
    }
    return count;
  }

  function getPressure(value) {
    const characters = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (characters >= 1000000) return { characters, level: 'overload', ratio: 1, label: '爆表 · 已达 100 万字' };
    if (characters > 50000) return { characters, level: 'warning', ratio: .42 + (characters - 50000) / 950000 * .58, label: '压力报警 · 已超过 5 万字' };
    if (characters >= 1000) return { characters, level: 'safe', ratio: .08 + (characters - 1000) / 49000 * .34, label: '安全区' };
    return { characters, level: characters ? 'collecting' : 'idle', ratio: characters / 1000 * .08, label: characters ? '资料积累中' : '等待资料' };
  }

  const api = Object.freeze({ countCharacters, getPressure });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.skillforgePressure = api;
})(globalThis);
