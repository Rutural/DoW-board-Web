'use strict';
const G = require('../game');

// 준비를 끝내고 첫 라운드가 시작된 게임
function playing(opts = { objective: 'samples', side: 'hard' }) {
  const g = G.newGame(opts);
  G.setupGame(g);
  for (const s of [0, 1]) {
    const p = g.players[s];
    G.apply(g, s, 'setup.pick', { picked: p.dealtSurvivors.slice(0, 3), leader: p.dealtSurvivors[0] });
  }
  return g;
}

// 특정 종류의 아이템 카드 id를 n장 찾는다
function cardsOfKind(g, kind, n) {
  return Object.keys(g.cards).filter((id) => G.TPL[g.cards[id].t].kind === kind).slice(0, n);
}

const colonySurvivors = (g) => Object.keys(g.survivors).filter((id) => g.survivors[id].loc === 'colony');

module.exports = { G, playing, cardsOfKind, colonySurvivors };
