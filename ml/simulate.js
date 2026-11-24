#!/usr/bin/env node
'use strict';
// 봇 시뮬레이션으로 학습 데이터 생성
// 사용법: node ml/simulate.js --games 2000 --seed 42 --out datasets/sim
// 결과: <out>/<run_id>/rows.jsonl + manifest.json (재현용 시드, 엔진·특징·봇 버전, 통계, 파일 해시)
//
// --store <경로|s3://…>: 시연용 "실제 게임 대역". 친구와 한 판이 아직 없을 때 모니터링·드리프트를 보여 주기 위한 데이터.
//   서버와 똑같이 운영 중인 모델로 라운드마다 예측을 기록하고, 저장소의 datasets/real/ 에 올린다 (행에 demo: true 표시).
//   사용법: node ml/simulate.js --store saves/store --games 80 --seed 3 --skill 1 --hard 1  (이 값들이 기본값)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const STORE = args.store;
const N = +(args.games || (STORE ? 80 : 1000));
const SEED = +(args.seed || (STORE ? 3 : 42));
const HARD_RATE = +(args.hard || (STORE ? 1 : 0.75));
const SKILL = args.skill != null ? +args.skill : STORE ? 1 : null; // null: 판마다 무작위

// 시드 고정 난수 (엔진의 Math.random까지 교체해 완전히 재현 가능하게)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED);
Math.random = rng;

const G = require('../game');
const { makeBot, BOT_VERSION } = require('./bot');

const objectives = Object.keys(G.OBJ);
function playOne(id) {
  const objective = objectives[Math.floor(rng() * objectives.length)];
  const side = rng() < HARD_RATE ? 'hard' : 'normal';
  const skill = SKILL ?? [0.55, 0.75, 0.9, 1][Math.floor(rng() * 4)];
  const g = G.newGame({ objective, side });
  g.id = id; // 재현성: 게임 id도 시드에서 결정
  G.setupGame(g);
  makeBot(G, { skill, rand: rng }).playGame(g);
  return { g, skill };
}

function simulate() {
  const OUT = path.resolve(args.out || path.join(__dirname, '..', 'datasets', 'sim'));
  const fileHash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12);
  const ENGINE_VERSION = fileHash(path.join(__dirname, '..', 'game.js'));
  const FEATURES_VERSION = fileHash(path.join(__dirname, 'features.js'));

  const runId = `${new Date().toISOString().slice(0, 10)}_s${SEED}_n${N}_${ENGINE_VERSION.slice(0, 6)}`;
  const dir = path.join(OUT, runId);
  fs.mkdirSync(dir, { recursive: true });
  const rowsFile = path.join(dir, 'rows.jsonl');
  const out = fs.createWriteStream(rowsFile);

  const stats = { games: 0, wins: 0, rows: 0, crisisFail: 0, crisisRows: 0 };
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const { g, skill } = playOne(`sim-s${SEED}-${String(i).padStart(6, '0')}`);
    if (g.phase !== 'ended') continue; // 안전장치(무한 진행 방지)
    const rows = G.exportRows(g, 'sim', { bot: BOT_VERSION, skill, seed: SEED });
    for (const r of rows) out.write(JSON.stringify(r) + '\n');
    stats.games++; stats.rows += rows.length; if (g.end.win) stats.wins++;
    for (const r of rows) if (r.y_crisis != null) { stats.crisisRows++; if (r.y_crisis === 0) stats.crisisFail++; }
  }
  out.end(() => {
    const manifest = {
      run_id: runId, created: new Date().toISOString(), source: 'sim', seed: SEED, games_requested: N, hard_rate: HARD_RATE,
      schema: G.FEAT.SCHEMA_VERSION, feature_names: G.FEAT.FEATURE_NAMES,
      engine_version: ENGINE_VERSION, features_version: FEATURES_VERSION, bot_version: BOT_VERSION,
      files: [{ name: 'rows.jsonl', sha256: fileHash(rowsFile), rows: stats.rows }],
      stats: { ...stats, win_rate: +(stats.wins / Math.max(1, stats.games)).toFixed(3), crisis_fail_rate: +(stats.crisisFail / Math.max(1, stats.crisisRows)).toFixed(3), seconds: +((Date.now() - t0) / 1000).toFixed(1) },
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✔ ${runId}: ${stats.games}판, ${stats.rows}행, 승률 ${manifest.stats.win_rate}, 위기 실패율 ${manifest.stats.crisis_fail_rate}, ${manifest.stats.seconds}초`);
    console.log('  ' + dir);
  });
}

async function demoToStore() {
  const { openStore, putRealGame } = require('./store');
  const { createModelServer } = require('./serving');
  const store = openStore(STORE);
  const models = createModelServer(store, { pollSeconds: 0, log: () => {} });
  await models.refresh();
  let rows = 0;
  for (let i = 0; i < N; i++) {
    const { g } = playOne(`demo-s${SEED}-${String(i).padStart(5, '0')}`);
    for (const t of g.trace) t.pred = models.predictAll(t.x);
    const out = G.exportRows(g, 'real', { demo: true });
    await putRealGame(store, g, out);
    rows += out.length;
  }
  console.log(`✔ 시연용 실제 게임 ${N}판 (${rows}행) → ${store.kind}:datasets/real/  예측 모델: ${Object.values(models.state.models).map((m) => m.version).join(', ') || '없음'}`);
}

if (STORE) demoToStore();
else simulate();
