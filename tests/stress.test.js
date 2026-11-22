'use strict';
// 무작위 행동·봇 대량 진행으로 엔진이 깨지지 않는지 확인
const test = require('node:test');
const assert = require('node:assert/strict');
const { G, playing } = require('./helpers');
const { makeBot } = require('../ml/bot');

const LOCS = ['colony', 'police', 'grocery', 'school', 'library', 'hospital', 'gas'];

test('무작위 행동 150판: 규칙 오류(GameError) 외의 예외 없음', () => {
  let crashes = 0;
  const objs = Object.keys(G.OBJ);
  for (let k = 0; k < 150; k++) {
    const g = playing({ objective: objs[k % objs.length], side: k % 2 ? 'hard' : 'normal', adult: k % 3 === 0 });
    let guard = 0;
    while (g.phase === 'play' && guard++ < 2500) {
      const seat = g.turn;
      const mine = Object.keys(g.survivors).filter((i) => g.survivors[i].owner === seat);
      const id = mine[Math.floor(Math.random() * mine.length)];
      const r = Math.random();
      try {
        if (g.pendingBite) G.apply(g, seat, 'bite.resolve', { choice: r < 0.5 ? 'die' : 'roll' });
        else if (g.pendingOverrun) G.apply(g, seat, 'overrun.clear');
        else if (g.stage === 'colony') {
          for (const a of ['colony.food', 'colony.waste', 'crisis.resolve', 'crisis.autoFail', 'colony.zombies']) {
            try { G.apply(g, 0, a); } catch (e) { if (!(e instanceof G.GameError)) throw e; }
          }
          if (g.phase !== 'play') break;
          G.apply(g, 0, 'colony.objective', { done: false });
          if (g.phase === 'play') G.apply(g, 0, 'colony.next');
        } else if (r < 0.25 && id) G.apply(g, seat, 'surv.move', { id, to: LOCS[Math.floor(Math.random() * 7)], exposure: 'roll' });
        else if (r < 0.35 && id) G.apply(g, seat, 'zombie.kill', { loc: g.survivors[id].loc, survivor: id, n: 1, exposure: true });
        else if (r < 0.45 && id && g.survivors[id].loc !== 'colony') {
          G.apply(g, seat, 'search.start', { loc: g.survivors[id].loc, survivor: id });
          G.apply(g, seat, 'search.take', { ids: [g.players[seat].search.cards[0]] });
        } else if (r < 0.55 && g.players[seat].hand.length) G.apply(g, seat, 'card.play', { id: g.players[seat].hand[0], target: id });
        else if (r < 0.62 && g.players[seat].hand.length) G.apply(g, seat, 'card.contribute', { id: g.players[seat].hand[0] });
        else if (r < 0.66 && g.xr && !g.xr.revealed) { G.apply(g, g.xr.by, 'xr.reveal'); G.apply(g, seat, 'xr.choose', { i: 0 }); G.apply(g, seat, 'xr.done'); }
        else if (r < 0.7) G.apply(g, seat, 'barricade', { loc: id ? g.survivors[id].loc : 'colony', d: 1 });
        else G.apply(g, seat, 'turn.end');
      } catch (e) {
        if (!(e instanceof G.GameError)) { crashes++; console.error(e); }
      }
      JSON.stringify(G.viewFor(g, 0)); JSON.stringify(G.viewFor(g, 1));
    }
  }
  assert.equal(crashes, 0);
});

test('봇 300판: 모두 정상 종료, 라운드 기록과 라벨 형식 일치', () => {
  const objs = Object.keys(G.OBJ);
  for (let k = 0; k < 300; k++) {
    const g = G.newGame({ objective: objs[k % objs.length], side: k % 4 ? 'hard' : 'normal' });
    G.setupGame(g);
    makeBot(G, { skill: [0.55, 0.75, 1][k % 3] }).playGame(g);
    assert.equal(g.phase, 'ended', `${k}번째 판이 끝나지 않음`);
    const rows = G.exportRows(g, 'sim');
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.equal(r.x.length, G.FEAT.FEATURE_NAMES.length);
      assert.ok(r.x.every(Number.isFinite));
      assert.ok([0, 1].includes(r.y_win) && [0, 1].includes(r.y_collapse));
      assert.ok(r.y_crisis === null || [0, 1].includes(r.y_crisis));
    }
  }
});
