#!/usr/bin/env node
'use strict';
// 시연용 "실제 게임 대역": 친구와 한 판이 아직 없을 때 모니터링·드리프트를 보여 주기 위한 데이터.
// 서버와 똑같이 운영 중인 모델로 라운드마다 예측을 기록하고, 저장소의 datasets/real/ 에 올린다 (행에 demo: true 표시).
// 사용법: node ml/demo_real_games.js --store saves/store --games 80 --seed 3 --skill 1 --hard 1
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(+(args.seed || 3));
Math.random = rng;

const path = require('path');
const G = require('../game');
const { makeBot } = require('./bot');
const { openStore } = require('./store');
const { createModelServer } = require('./serving');

(async () => {
  const store = openStore(args.store || path.join(__dirname, '..', 'saves', 'store'));
  const models = createModelServer(store, { pollSeconds: 0, log: () => {} });
  await models.refresh();
  const N = +(args.games || 80), skill = args.skill != null ? +args.skill : 1, hard = args.hard != null ? +args.hard : 1;
  const objs = Object.keys(G.OBJ);
  const day = new Date().toISOString().slice(0, 10);
  let rows = 0;
  for (let i = 0; i < N; i++) {
    const g = G.newGame({ objective: objs[Math.floor(rng() * objs.length)], side: rng() < hard ? 'hard' : 'normal' });
    g.id = `demo-s${args.seed || 3}-${String(i).padStart(5, '0')}`;
    G.setupGame(g);
    makeBot(G, { skill, rand: rng }).playGame(g);
    for (const t of g.trace) { const p = models.predictAll(t.x); t.pred = Object.keys(p).length ? p : null; }
    const out = G.exportRows(g, 'real', { demo: true });
    await store.put(`datasets/real/date=${day}/${g.id}.jsonl`, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
    rows += out.length;
  }
  console.log(`✔ 시연용 실제 게임 ${N}판 (${rows}행) → ${store.kind}:datasets/real/date=${day}/  예측 모델: ${Object.values(models.state.models).map((m) => m.version).join(', ') || '없음'}`);
})();
