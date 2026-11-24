'use strict';
// 데드 오브 윈터 본판 · 2인 협력 변형 · 보드 도우미 상태 엔진
// 판정은 사람이 하고, 이 모듈은 상태 보관 · 덱 관리 · 계산 보조만 맡는다.

const fs = require('fs');
const crypto = require('crypto');
const FEAT = require('./ml/features');
const path = require('path');

const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'));
const DATA = {
  survivors: D('survivors.json'),
  items: D('items.json'),
  game: D('game.json'),
  crossroads: D('crossroads.json'),
  itemCards: D('item_cards.json'),
  images: D('images.json'),
};
const SURV = Object.fromEntries(DATA.survivors.map((s) => [s.id, s]));
const TPL = DATA.items.templates;
const CRISIS = Object.fromEntries(DATA.game.crises.map((c) => [c.id, c]));
const XR = Object.fromEntries(DATA.crossroads.map((c) => [c.id, c]));
const OBJ = Object.fromEntries(DATA.game.objectives.map((o) => [o.id, o]));
const LOCS = DATA.game.locations;
const OUTSIDE = LOCS.filter((l) => l.id !== 'colony').map((l) => l.id);
const LOC = Object.fromEntries(LOCS.map((l) => [l.id, l]));

const EXPOSURE = [
  ...Array(6).fill('blank'), ...Array(3).fill('wound'), ...Array(2).fill('frost'), 'bite',
];
const EXPOSURE_KO = { blank: '빈칸', wound: '부상', frost: '동상', bite: '물림' };

const rnd = (n) => Math.floor(Math.random() * n);
const d6 = () => 1 + rnd(6);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

class GameError extends Error {}
const fail = (m) => { throw new GameError(m); };
// 배열에서 x를 꺼낸다 (없으면 msg로 실패)
function pluck(arr, x, msg) {
  const k = arr ? arr.indexOf(x) : -1;
  if (k < 0) fail(msg);
  arr.splice(k, 1); return x;
}

// ───────────────────────── 생성 ─────────────────────────

function newGame(settings) {
  const g = {
    v: 1,
    id: crypto.randomBytes(6).toString('hex'),
    created: Date.now(),
    trace: [],
    phase: 'setup', // setup → play → ended
    settings: {
      objective: settings.objective || 'samples',
      side: settings.side === 'normal' ? 'normal' : 'hard',
      adult: !!settings.adult,
    },
    seq: 0,
    cards: {}, // 아이템 카드 인스턴스 id → { t: 템플릿키, o: 출신 }
    morale: 0, round: 0, food: 0, starvation: 0, helpless: 0, samples: 0,
    waste: [], removed: [], underObjective: [],
    objectiveDone: false,
    crisis: null, crisisDeck: [], crisisPile: [], crisisResolved: null,
    effects: [], // 진행 중 효과 메모(사람이 관리)
    locs: {},
    survivors: {}, // 게임에 나온 생존자 id → 상태
    survivorDeck: [],
    xrDeck: [], xr: null,
    players: [0, 1].map(() => ({ hand: [], dice: [], dealtSurvivors: [], picked: [], leader: null, ready: false, search: null, handOpen: false })),
    startPlayer: 0, turn: 0, stage: 'player', turnCount: 0,
    log: [], end: null,
  };
  for (const l of LOCS) {
    if (l.id === 'colony') g.locs.colony = { entrances: Array.from({ length: l.entrances }, () => ({ z: 0, b: 0 })) };
    else g.locs[l.id] = { z: 0, b: 0, noise: 0, deck: [], searched: false };
  }
  return g;
}

function makeCards(g, deckKey) {
  return shuffle(DATA.itemCards[deckKey].map((c) => {
    const id = 'c' + (++g.seq);
    g.cards[id] = { t: c.t, o: deckKey, img: c.img };
    return id;
  }));
}

function setupGame(g) {
  const obj = objectiveSide(g);
  // 덱 준비
  g.crisisDeck = shuffle(DATA.game.crises.map((c) => c.id));
  g.survivorDeck = shuffle(DATA.survivors.filter((s) => !s.noncoop).map((s) => s.id));
  g.xrDeck = shuffle(DATA.crossroads
    .filter((c) => !c.tags.includes('비협력'))
    .filter((c) => g.settings.adult || !c.tags.includes('성인 테마'))
    .map((c) => c.id));
  for (const id of OUTSIDE) g.locs[id].deck = makeCards(g, id);
  const start = makeCards(g, 'start');
  // 2인 변형: 시작 아이템 7장, 생존자 4장 중 3장
  for (const p of g.players) {
    p.hand = start.splice(0, 7);
    p.dealtSurvivors = g.survivorDeck.splice(0, 4);
  }
  g.morale = obj.morale;
  g.round = obj.rounds;
  g.helpless = obj.helplessPerPlayer * 2 + obj.helplessFlat;
  log(g, `공동목표: ${objectiveTitle(g)} (${g.settings.side === 'hard' ? '하드코어' : '일반'}면) · 사기 ${g.morale} · 라운드 ${g.round}`);
  log(g, '각자 생존자 4명 중 3명을 고르고 그중 1명을 리더로 정하세요.');
}

function objectiveSide(g) { return OBJ[g.settings.objective].sides[g.settings.side]; }
function objectiveTitle(g) { const o = OBJ[g.settings.objective]; return objectiveSide(g).title || o.name; }

function finishSetup(g) {
  // 선택하지 않은 생존자는 덱으로 돌려 섞는다
  for (let s = 0; s < 2; s++) {
    const p = g.players[s];
    for (const id of p.dealtSurvivors) if (!p.picked.includes(id)) g.survivorDeck.push(id);
    for (const id of p.picked) addSurvivor(g, id, s, 'colony', id === p.leader);
    p.dealtSurvivors = []; p.picked = [];
  }
  shuffle(g.survivorDeck);
  const obj = objectiveSide(g);
  if (obj.colonyZ) placeZombies(g, 'colony', obj.colonyZ, '준비');
  if (obj.otherZ) for (const id of OUTSIDE) placeZombies(g, id, obj.otherZ, '준비');
  const inf = [0, 1].map((s) => SURV[g.players[s].leader].inf);
  g.startPlayer = inf[0] >= inf[1] ? 0 : 1;
  g.phase = 'play';
  log(g, `리더 영향력이 가장 높은 P${g.startPlayer + 1}이(가) 시작 플레이어입니다.`);
  beginRound(g);
}

function addSurvivor(g, id, seat, loc, leader) {
  g.survivors[id] = { owner: seat, loc, wounds: 0, frost: 0, leader: !!leader, moved: false, used: false, equip: [], notes: [] };
}

// ───────────────────────── 계산 보조 ─────────────────────────

function survivorsAt(g, loc) { return Object.entries(g.survivors).filter(([, s]) => s.loc === loc).map(([id]) => id); }
function colonyPop(g) { return survivorsAt(g, 'colony').length + g.helpless; }
function locCapacity(loc) { return LOC[loc].slots; }
function locOccupancy(g, loc) { return survivorsAt(g, loc).length + (loc === 'colony' ? g.helpless : 0); }
function diceCount(g, seat) {
  const mine = Object.values(g.survivors).filter((s) => s.owner === seat);
  const nvg = mine.reduce((a, s) => a + s.equip.filter((c) => TPL[g.cards[c].t].bonusDie).length, 0);
  return 1 + mine.length + nvg;
}
function lowestInfluence(g, loc) {
  const ids = survivorsAt(g, loc);
  if (!ids.length) return null;
  return ids.sort((a, b) => SURV[a].inf - SURV[b].inf)[0];
}
function foodNeeded(g) {
  const horse = Object.values(g.survivors).filter((s) => s.notes.some((n) => n.startsWith('말'))).length;
  return Math.ceil(colonyPop(g) / 2) + horse;
}

// 입구(피난기지는 입구 하나, 다른 장소는 장소 전체)에 빈 칸이 있는가
const hasRoom = (slot, loc) => slot.z + slot.b < LOC[loc].entranceSlots;

// 좀비 1마리씩 배치. 피난기지는 입구 1→6 순환, 매 효과마다 입구 1부터.
function placeZombies(g, loc, n, why) {
  let broken = 0, overruns = 0;
  for (let i = 0; i < n; i++) {
    const slot = loc === 'colony' ? g.locs.colony.entrances[i % LOC.colony.entrances] : g.locs[loc];
    if (hasRoom(slot, loc)) slot.z++;
    else if (slot.b > 0) { slot.b--; broken++; }
    else overruns++;
  }
  let msg = `${LOC[loc].name}에 좀비 ${n}마리 추가${why ? ` (${why})` : ''}`;
  if (broken) msg += ` · 바리케이드 ${broken}개 파괴`;
  if (overruns) msg += ` · ⚠ 침입 ${overruns}회!`;
  log(g, msg);
  // 침입: 그 장소에서 영향력이 가장 낮은 생존자 사망 (피난기지에 노약자만 있으면 노약자) — 규칙상 선택 없음
  const victims = [];
  for (let i = 0; i < overruns && g.phase !== 'ended'; i++) {
    const v = lowestInfluence(g, loc);
    if (v) { victims.push(SURV[v].name); killSurvivor(g, v, `${LOC[loc].name} 침입`); }
    else if (loc === 'colony' && g.helpless > 0) { g.helpless--; victims.push('노약자'); log(g, '✝ 침입으로 노약자 1명 사망 · 사기 −1'); changeMorale(g, -1); }
  }
  if (overruns) g.pendingOverrun = { loc, count: overruns, victims };
}

function removeZombie(g, loc, entrance) {
  if (loc === 'colony') {
    let e = entrance != null ? g.locs.colony.entrances[entrance] : null;
    if (!e || e.z === 0) e = g.locs.colony.entrances.find((x) => x.z > 0);
    if (!e) return false;
    e.z--; return true;
  }
  if (g.locs[loc].z <= 0) return false;
  g.locs[loc].z--; return true;
}

function addBarricade(g, loc) {
  if (loc === 'colony') {
    const es = g.locs.colony.entrances;
    // 가장 바리케이드가 적은 빈 입구부터
    const order = es.map((e, i) => i).filter((i) => hasRoom(es[i], 'colony'))
      .sort((a, b) => es[a].b - es[b].b || a - b);
    if (!order.length) return false;
    es[order[0]].b++; return true;
  }
  const l = g.locs[loc];
  if (!hasRoom(l, loc)) return false;
  l.b++; return true;
}

// ───────────────────────── 라운드 진행 ─────────────────────────

function beginRound(g) {
  g.stage = 'player';
  g.turn = g.startPlayer;
  g.turnCount = 0;
  g.crisisResolved = null;
  for (const s of Object.values(g.survivors)) { s.used = false; s.moved = false; s.equipUsed = []; }
  // 위기 공개
  if (!g.crisisDeck.length) { g.crisisDeck = shuffle(g.crisisPile); g.crisisPile = []; }
  g.crisis = { id: g.crisisDeck.shift(), contrib: [] };
  log(g, `━━ 라운드 ${g.round} 시작 · 위기 공개: ${CRISIS[g.crisis.id].name} (필요: ${needText(g.crisis.id)})`);
  // 주사위 굴림
  for (let s = 0; s < 2; s++) rollDice(g, s);
  snapshotRound(g);
  startTurn(g);
}

function needText(cid) { return CRISIS[cid].need.map((k) => DATA.game.kinds[k]).join(' 또는 '); }

function rollDice(g, seat) {
  const n = diceCount(g, seat);
  g.players[seat].dice = Array.from({ length: n }, () => ({ v: d6(), used: false }));
  log(g, `P${seat + 1} 행동 주사위 ${n}개: ${g.players[seat].dice.map((d) => d.v).join(', ')}`);
}

function startTurn(g) {
  const seat = g.turn;
  for (const s of Object.values(g.survivors)) s.moved = s.owner === seat ? false : s.moved;
  // 크로스로드: 턴 플레이어 오른쪽 사람(2인에서는 상대)이 1장을 뽑는다
  if (!g.xrDeck.length) log(g, '크로스로드 덱이 비었습니다.');
  else {
    g.xr = { id: g.xrDeck.shift(), for: seat, by: 1 - seat, revealed: false, chosen: null };
  }
  log(g, `▶ P${seat + 1}의 턴 (크로스로드는 P${2 - seat}이(가) 비공개로 들고 있습니다)`);
  // 동상 틱
  const frosted = Object.entries(g.survivors).filter(([, s]) => s.owner === seat && s.frost > 0);
  for (const [id, s] of frosted) {
    s.wounds++;
    log(g, `동상: ${SURV[id].name} 부상 +1 (턴 시작)`);
    checkDeath(g, id);
  }
}

function endTurn(g) {
  // 발동하지 않은 크로스로드는 덱 맨 아래
  if (g.xr && !g.xr.revealed) { g.xrDeck.push(g.xr.id); log(g, '발동하지 않은 크로스로드를 덱 맨 아래로 돌려놓았습니다.'); }
  g.xr = null;
  for (const p of g.players) if (p.search) { g.locs[p.search.loc].deck.push(...p.search.cards); p.search = null; }
  g.turnCount++;
  if (g.turnCount >= 2) {
    g.stage = 'colony';
    g.colonySteps = {};
    log(g, '━━ 피난기지 단계: 식량 → 쓰레기 → 위기 → 좀비 → 공동목표 → 라운드 → 시작 플레이어');
  } else {
    g.turn = 1 - g.turn; // 2인: 왼쪽 = 상대
    startTurn(g);
  }
}

function checkDeath(g, id) {
  const s = g.survivors[id];
  if (s.wounds + s.frost >= FEAT.maxWounds(SURV[id])) killSurvivor(g, id, '부상 누적');
}

function killSurvivor(g, id, why, noMorale) {
  const s = g.survivors[id];
  if (!s) return;
  // 장착 카드: 피난기지에서 죽으면 손으로, 다른 장소면 그 장소 덱에 섞기
  if (s.equip.length) {
    if (s.loc === 'colony') g.players[s.owner].hand.push(...s.equip);
    else { g.locs[s.loc].deck.push(...s.equip); shuffle(g.locs[s.loc].deck); }
  }
  const { owner } = s;
  delete g.survivors[id];
  g.dead = g.dead || [];
  g.dead.push(id);
  log(g, `✝ ${SURV[id].name} 사망 (${why})${noMorale ? '' : ' · 사기 −1'}`);
  if (!noMorale) changeMorale(g, -1);
  const mine = Object.entries(g.survivors).filter(([, x]) => x.owner === owner);
  if (!mine.length && g.phase === 'play') {
    // 마지막 생존자: 손 카드 전부 제거 후 새 생존자를 리더로
    g.removed.push(...g.players[owner].hand);
    g.players[owner].hand = [];
    const nid = g.survivorDeck.shift();
    if (nid) {
      addSurvivor(g, nid, owner, 'colony', true);
      log(g, `P${owner + 1}의 마지막 생존자를 잃었습니다. 손패를 모두 제거하고 ${SURV[nid].name}이(가) 새 리더가 됩니다.`);
    }
  } else if (s.leader && mine.length) {
    g.players[owner].needLeader = true;
    log(g, `P${owner + 1}: 리더를 잃었습니다. 추종자 중 새 리더를 정하세요.`);
  }
}

function changeMorale(g, d) {
  g.morale = Math.max(0, Math.min(10, g.morale + d));
  if (g.morale === 0 && g.phase === 'play') endGame(g, '사기가 0이 되었습니다.', false);
}

function endGame(g, why, win) {
  g.phase = 'ended';
  g.end = { why, win, round: g.round, at: Date.now() };
  log(g, `■ 게임 종료: ${why} ${win ? '공동목표 달성! 승리!' : '패배…'}`);
}

function log(g, text) {
  g.log.push({ t: Date.now(), text });
  if (g.log.length > 400) g.log.splice(0, g.log.length - 400);
}

function exposureRoll() { return EXPOSURE[rnd(12)]; }

// ───────────────────────── 액션 ─────────────────────────
// 보드 도우미이므로 대부분의 액션은 누구나 할 수 있다(사람이 판정).
// 비공개 정보(손패·탐색 중 카드·크로스로드)만 주인 확인을 한다.

const A = {};

A['setup.pick'] = (g, seat, { picked, leader }) => {
  if (g.phase !== 'setup') fail('준비 단계가 아닙니다.');
  const p = g.players[seat];
  if (!Array.isArray(picked) || picked.length !== 3 || !picked.every((id) => p.dealtSurvivors.includes(id))) fail('받은 생존자 4명 중 정확히 3명을 고르세요.');
  if (!picked.includes(leader)) fail('리더는 고른 3명 중 1명이어야 합니다.');
  p.picked = picked; p.leader = leader; p.ready = true;
  log(g, `P${seat + 1} 생존자 선택 완료`);
  if (g.players.every((x) => x.ready)) finishSetup(g);
};

A['setup.unready'] = (g, seat) => { if (g.phase === 'setup') g.players[seat].ready = false; };

// 트랙
A['track'] = (g, seat, { key, d }) => {
  const names = { morale: '사기', round: '라운드', food: '식량', starvation: '굶주림', helpless: '노약자', samples: '샘플' };
  if (!Object.hasOwn(names, key)) fail('잘못된 트랙');
  if (key === 'helpless' && d > 0 && locOccupancy(g, 'colony') >= locCapacity('colony')) fail('피난기지 생존자 칸이 가득 찼습니다.');
  if (key === 'morale') { changeMorale(g, d); }
  else g[key] = Math.max(0, g[key] + d);
  if (key === 'round') g.round = Math.min(10, g.round);
  log(g, `P${seat + 1}: ${names[key]} ${d > 0 ? '+' : ''}${d} → ${g[key]}`);
  if (key === 'helpless' && d < 0) log(g, '노약자가 죽었다면 사기도 −1 하세요.');
};

// 주사위 (unusedMsg가 있으면 미사용 주사위만 허용)
function dieAt(g, seat, i, unusedMsg) {
  const d = g.players[seat].dice[i];
  if (!d || (unusedMsg && d.used)) fail(unusedMsg || '주사위 없음');
  return d;
}
A['dice.use'] = (g, seat, { i }) => { const d = dieAt(g, seat, i); d.used = !d.used; };
A['dice.set'] = (g, seat, { i, v }) => {
  const d = dieAt(g, seat, i);
  v = Math.max(1, Math.min(6, v | 0)); log(g, `P${seat + 1}: 주사위 ${d.v} → ${v}`); d.v = v;
};
A['dice.reroll'] = (g, seat, { i }) => {
  const d = dieAt(g, seat, i, '미사용 주사위만 다시 굴릴 수 있습니다.');
  const o = d.v; d.v = d6(); log(g, `P${seat + 1}: 주사위 다시 굴림 ${o} → ${d.v}`);
};
A['dice.food'] = (g, seat, { i }) => {
  const d = dieAt(g, seat, i, '미사용 주사위를 고르세요.');
  if (d.v >= 6) fail('6보다 올릴 수 없습니다.');
  if (g.food <= 0) fail('식량 토큰이 없습니다.');
  g.food--; d.v++; log(g, `P${seat + 1}: 식량 토큰 1개로 주사위 +1 → ${d.v} (식량 ${g.food})`);
};
A['dice.add'] = (g, seat, { d }) => {
  const p = g.players[seat];
  if (d > 0) { p.dice.push({ v: d6(), used: false }); log(g, `P${seat + 1}: 주사위 1개 추가 → ${p.dice.at(-1).v}`); }
  else { const k = p.dice.findIndex((x) => !x.used); if (k >= 0) { p.dice.splice(k, 1); log(g, `P${seat + 1}: 주사위 1개 제거`); } }
};
A['roll.d6'] = (g, seat, { label }) => { log(g, `🎲 P${seat + 1} 주사위${label ? ` (${label})` : ''}: ${d6()}`); };

// 생존자
function ownSurv(g, seat, id) { const s = g.survivors[id]; if (!s) fail('생존자 없음'); return s; }

A['surv.move'] = (g, seat, { id, to, exposure }) => {
  const s = ownSurv(g, seat, id);
  if (!LOC[to] || to === s.loc) fail('목적지를 확인하세요.');
  if (locOccupancy(g, to) >= locCapacity(to)) fail(`${LOC[to].name}에 빈 생존자 칸이 없습니다.`);
  const from = s.loc;
  s.loc = to; s.moved = true;
  const r = exposure === 'roll' && exposureRoll();
  const note = r ? ` · 위험노출 굴림: ${EXPOSURE_KO[r]}` : exposure === 'fuel' ? ' (연료 사용 · 굴림 없음)' : exposure === 'none' ? ' (굴림 없음)' : '';
  log(g, `${SURV[id].name}: ${LOC[from].name} → ${LOC[to].name}${note}`);
  if (r) applyExposure(g, id, r);
};

// 동상 면역(하먼·설피): 동상 대신 일반 부상
const frostProof = (g, id) => id === 'harman' || g.survivors[id].equip.some((c) => g.cards[c].t === 'snowshoes');

function applyExposure(g, id, r) {
  const s = g.survivors[id];
  if (r === 'bite' && SURV[id].animal) { log(g, '스파키: 물림을 부상으로 취급'); r = 'wound'; }
  if (r === 'frost' && frostProof(g, id)) { log(g, '동상 대신 일반 부상'); r = 'wound'; }
  if (r === 'wound') { s.wounds++; checkDeath(g, id); }
  else if (r === 'frost') { s.frost++; checkDeath(g, id); }
  else if (r === 'bite') {
    const loc = s.loc;
    killSurvivor(g, id, '물림');
    spreadBite(g, loc, '. 조종자가 선택: 죽이기 또는 위험노출 재굴림(빈칸만 생존)');
  }
}

// 물림 확산: 같은 장소의 영향력 최저 생존자(동물·살점 장착 제외)가 다음 대상
function spreadBite(g, loc, note = '') {
  const next = survivorsAt(g, loc)
    .filter((id) => !SURV[id].animal && !g.survivors[id].equip.some((c) => g.cards[c].t === 'flesh'))
    .sort((a, b) => SURV[a].inf - SURV[b].inf)[0];
  if (next) { g.pendingBite = { loc, target: next }; log(g, `⚠ 물림 확산 → ${SURV[next].name}${note}`); }
}

A['bite.resolve'] = (g, seat, { choice }) => {
  const b = g.pendingBite; if (!b) fail('진행 중인 물림 확산이 없습니다.');
  const id = b.target;
  g.pendingBite = null;
  if (!g.survivors[id]) return;
  if (choice === 'die') { killSurvivor(g, id, '물림 확산'); return; }
  const r = exposureRoll();
  log(g, `${SURV[id].name} 물림 확산 재굴림: ${EXPOSURE_KO[r]}`);
  if (r === 'blank') { log(g, '살아남았습니다. 확산이 멈춥니다.'); return; }
  killSurvivor(g, id, '물림 확산');
  spreadBite(g, b.loc);
};

A['surv.exposure'] = (g, seat, { id }) => {
  ownSurv(g, seat, id);
  const r = exposureRoll();
  log(g, `☠ ${SURV[id].name} 위험노출 굴림: ${EXPOSURE_KO[r]}`);
  applyExposure(g, id, r);
};
A['surv.wound'] = (g, seat, { id, kind, d }) => {
  const s = ownSurv(g, seat, id);
  const k = kind === 'frost' ? 'frost' : 'wounds';
  if (d > 0 && k === 'frost' && frostProof(g, id)) {
    s.wounds++; log(g, `${SURV[id].name}: 동상 대신 일반 부상 +1`);
  } else {
    s[k] = Math.max(0, s[k] + d);
    log(g, `${SURV[id].name}: ${k === 'frost' ? '동상' : '부상'} ${d > 0 ? '+1' : '−1'}`);
  }
  checkDeath(g, id);
};
A['surv.kill'] = (g, seat, { id, noMorale }) => { ownSurv(g, seat, id); killSurvivor(g, id, '직접 처리', noMorale); };
A['surv.removeFromGame'] = (g, seat, { id }) => {
  const s = ownSurv(g, seat, id);
  if (s.equip.length) g.players[s.owner].hand.push(...s.equip);
  delete g.survivors[id]; g.dead = g.dead || []; g.dead.push(id);
  log(g, `${SURV[id].name}을(를) 게임에서 제거했습니다 (사망 아님, 사기 변화 없음).`);
};
A['surv.leader'] = (g, seat, { id }) => {
  const s = ownSurv(g, seat, id);
  for (const x of Object.values(g.survivors)) if (x.owner === s.owner) x.leader = false;
  s.leader = true; g.players[s.owner].needLeader = false;
  log(g, `P${s.owner + 1}의 새 리더: ${SURV[id].name}`);
};
A['surv.give'] = (g, seat, { id }) => {
  const s = ownSurv(g, seat, id);
  s.owner = 1 - s.owner; s.leader = false;
  log(g, `${SURV[id].name}을(를) P${s.owner + 1}에게 넘겼습니다.`);
};
A['surv.used'] = (g, seat, { id }) => { const s = ownSurv(g, seat, id); s.used = !s.used; if (s.used) log(g, `${SURV[id].name} 능력 사용`); };
A['surv.note'] = (g, seat, { id, text, remove }) => {
  const s = ownSurv(g, seat, id);
  if (remove != null) s.notes.splice(remove, 1);
  else if (text) { s.notes.push(String(text).slice(0, 60)); log(g, `${SURV[id].name}: 메모 "${text}"`); }
};
A['surv.recruit'] = (g, seat, { id, to }) => {
  // 생존자 덱 맨 위(또는 지정 생존자)를 추종자로 추가
  const loc = to || 'colony';
  if (locOccupancy(g, loc) >= locCapacity(loc)) fail(`${LOC[loc].name}에 빈 생존자 칸이 없습니다.`);
  const sid = id ? pluck(g.survivorDeck, id, '생존자 덱에 없는 생존자입니다.') : g.survivorDeck.shift();
  if (!sid) fail('생존자 덱이 비었습니다.');
  addSurvivor(g, sid, seat, loc, false);
  log(g, `P${seat + 1}: ${SURV[sid].name} 합류 (${LOC[loc].name})`);
};

// 좀비·바리케이드·소음
A['zombie'] = (g, seat, { loc, d, entrance }) => {
  if (!LOC[loc]) fail('장소 없음');
  if (d > 0) placeZombies(g, loc, d, `P${seat + 1}`);
  else {
    if (!removeZombie(g, loc, entrance)) fail('좀비가 없습니다.');
    log(g, `P${seat + 1}: ${LOC[loc].name} 좀비 1마리 제거`);
  }
};
A['zombie.kill'] = (g, seat, { loc, survivor, n, exposure, entrance }) => {
  n = Math.max(1, n | 0);
  let k = 0; for (let i = 0; i < n; i++) if (removeZombie(g, loc, entrance)) k++;
  if (!k) fail('좀비가 없습니다.');
  let msg = `${survivor ? SURV[survivor].name + ': ' : ''}${LOC[loc].name} 좀비 ${k}마리 처치`;
  log(g, msg);
  if (g.settings.objective === 'samples') log(g, '샘플 목표: 처치한 좀비마다 주사위를 굴려 4 이상이면 샘플 +1');
  if (survivor && exposure) A['surv.exposure'](g, seat, { id: survivor });
};
A['zombie.lure'] = (g, seat, { from, to }) => {
  // 옮길 칸: 피난기지는 첫 빈 입구, 다른 장소는 그 장소 (좀비를 뺀 뒤 다시 찾는다)
  const room = () => (to === 'colony' ? g.locs.colony.entrances.find((e) => hasRoom(e, to)) : hasRoom(g.locs[to], to) && g.locs[to]);
  let moved = 0;
  for (let i = 0; i < 2; i++) {
    if (!room() || !removeZombie(g, from)) break;
    room().z++;
    moved++;
  }
  log(g, `좀비 유인: ${LOC[from].name} → ${LOC[to].name} ${moved}마리`);
};
A['barricade'] = (g, seat, { loc, d, entrance }) => {
  if (d > 0) {
    if (loc === 'colony' && entrance != null) {
      const e = g.locs.colony.entrances[entrance];
      if (!hasRoom(e, 'colony')) fail('그 입구에 빈 칸이 없습니다.');
      e.b++;
    } else if (!addBarricade(g, loc)) fail('빈 입구 칸이 없습니다.');
    log(g, `P${seat + 1}: ${LOC[loc].name} 바리케이드 +1${entrance != null ? ` (입구 ${entrance + 1})` : ''}`);
  } else {
    if (loc === 'colony') {
      const es = g.locs.colony.entrances;
      const e = entrance != null && es[entrance].b > 0 ? es[entrance] : [...es].reverse().find((x) => x.b > 0);
      if (!e) fail('바리케이드가 없습니다.'); e.b--;
    } else { if (!g.locs[loc].b) fail('바리케이드가 없습니다.'); g.locs[loc].b--; }
    log(g, `P${seat + 1}: ${LOC[loc].name} 바리케이드 −1`);
  }
};
A['noise'] = (g, seat, { loc, d }) => {
  const l = g.locs[loc]; if (!l || loc === 'colony') fail('소음은 피난기지가 아닌 장소에만 놓습니다.');
  l.noise = Math.max(0, Math.min(LOC[loc].noise, l.noise + d));
  log(g, `${LOC[loc].name} 소음 ${d > 0 ? '+1' : '−1'} → ${l.noise}`);
};
A['overrun.clear'] = (g) => { g.pendingOverrun = null; };

// 탐색
A['search.start'] = (g, seat, { loc, survivor }) => {
  const p = g.players[seat];
  if (p.search) fail('이미 탐색 중입니다.');
  if (loc === 'colony' || !g.locs[loc]) fail('피난기지에서는 탐색할 수 없습니다.');
  const deck = g.locs[loc].deck;
  if (!deck.length) fail('아이템 덱이 비었습니다.');
  p.search = { loc, survivor: survivor || null, cards: [deck.shift()] };
  g.locs[loc].searched = true;
  log(g, `P${seat + 1}: ${survivor ? SURV[survivor].name + '(으)로 ' : ''}${LOC[loc].name} 탐색`);
};
function searcher(g, seat) { const p = g.players[seat]; if (!p.search) fail('탐색 중이 아닙니다.'); return p; }
A['search.more'] = (g, seat, { noise }) => {
  const s = searcher(g, seat).search;
  const l = g.locs[s.loc];
  if (noise) {
    if (l.noise >= LOC[s.loc].noise) fail('빈 소음 칸이 없습니다.');
    l.noise++;
    log(g, `P${seat + 1}: 소음을 내고 1장 더 봄 (${LOC[s.loc].name} 소음 ${l.noise})`);
  } else log(g, `P${seat + 1}: 능력/장비로 1장 더 봄`);
  if (!l.deck.length) fail('덱에 더 이상 카드가 없습니다.');
  s.cards.push(l.deck.shift());
};
A['search.take'] = (g, seat, { ids }) => {
  const p = searcher(g, seat); const s = p.search;
  if (!Array.isArray(ids) || !ids.length || !ids.every((x) => s.cards.includes(x))) fail('가져갈 카드를 고르세요.');
  p.hand.push(...ids);
  const rest = s.cards.filter((x) => !ids.includes(x));
  g.locs[s.loc].deck.push(...rest);
  log(g, `P${seat + 1}: 탐색으로 ${ids.length}장 획득, ${rest.length}장은 덱 맨 아래로`);
  p.search = null;
};

// 손패
const takeFromHand = (g, seat, id) => pluck(g.players[seat].hand, id, '손에 없는 카드입니다.');
const cardName = (g, id) => TPL[g.cards[id].t].name;

A['card.play'] = (g, seat, { id, target }) => {
  const t = g.players[seat].hand.includes(id) && TPL[g.cards[id].t]; // 손에 없으면 takeFromHand가 실패시킨다
  if (t.use === 'equip' && !g.survivors[target]) fail('장착할 생존자를 고르세요.');
  takeFromHand(g, seat, id);
  if (t.use === 'equip') {
    g.survivors[target].equip.push(id);
    log(g, `P${seat + 1}: ${t.name}을(를) ${SURV[target].name}에게 장착`);
    return;
  }
  g.waste.push(id);
  let msg = `P${seat + 1}: ${t.name} 사용 → 쓰레기장`;
  if (t.food) { g.food += t.food; msg += ` · 식량 +${t.food} (${g.food})`; }
  log(g, msg);
  if (t.addSurvivors) {
    const n = t.addHelpless || 0;
    if (locOccupancy(g, 'colony') + 1 + n > locCapacity('colony')) log(g, '⚠ 피난기지 칸이 부족합니다. 규칙상 이 카드는 사용할 수 없습니다 — 되돌리기를 누르세요.');
    else {
      A['surv.recruit'](g, seat, {});
      if (n) { g.helpless += n; log(g, `노약자 +${n}`); }
    }
  }
};
A['card.waste'] = (g, seat, { id }) => { takeFromHand(g, seat, id); g.waste.push(id); log(g, `P${seat + 1}: ${cardName(g, id)} → 쓰레기장 (효과 없이)`); };
A['card.remove'] = (g, seat, { id }) => { takeFromHand(g, seat, id); g.removed.push(id); log(g, `P${seat + 1}: ${cardName(g, id)} → 게임에서 제거`); };
A['card.give'] = (g, seat, { id }) => { takeFromHand(g, seat, id); g.players[1 - seat].hand.push(id); log(g, `P${seat + 1} → P${2 - seat}: ${cardName(g, id)} 전달 (요청 카드는 받은 사람이 즉시 사용)`); };
A['card.contribute'] = (g, seat, { id, from }) => {
  if (!g.crisis) fail('현재 위기가 없습니다.');
  if (from) pluck(g.survivors[from]?.equip, id, '장착 카드가 아닙니다.'); // 장착 카드 기여
  else takeFromHand(g, seat, id);
  g.crisis.contrib.push({ id, by: seat });
  log(g, `P${seat + 1}: 위기에 카드 1장을 뒷면으로 기여 (총 ${g.crisis.contrib.length}장)`);
};
A['card.objective'] = (g, seat, { id }) => {
  takeFromHand(g, seat, id);
  g.underObjective.push(id);
  const c = g.cards[id];
  log(g, `P${seat + 1}: ${cardName(g, id)}을(를) 공동목표 아래에 놓음${c.o === 'start' ? ' (⚠ 시작 아이템은 세지 않는 목표가 많습니다)' : ''}`);
};
A['card.unequip'] = (g, seat, { id, survivor, to }) => {
  const s = g.survivors[survivor];
  pluck(s?.equip, id, '장착 카드가 아닙니다.');
  const dest = { waste: [g.waste, '쓰레기장'], removed: [g.removed, '게임에서 제거'], hand: [g.players[s.owner].hand, '손으로'] };
  const [arr, where] = dest[Object.hasOwn(dest, to) ? to : 'hand'];
  arr.push(id); log(g, `${SURV[survivor].name}의 ${cardName(g, id)} → ${where}`);
};
A['card.transfer'] = (g, seat, { id, from, to }) => {
  const s = g.survivors[from]; const t = g.survivors[to];
  if (!t || !s?.equip.includes(id)) fail('대상을 확인하세요.');
  if (s.loc !== t.loc) fail('같은 장소의 생존자에게만 긴급 전달할 수 있습니다.');
  pluck(s.equip, id); t.equip.push(id);
  log(g, `긴급 전달: ${SURV[from].name} → ${SURV[to].name} (${cardName(g, id)})`);
};
A['card.equipUsed'] = (g, seat, { id, survivor }) => {
  const s = ownSurv(g, seat, survivor);
  s.equipUsed = s.equipUsed || [];
  const k = s.equipUsed.indexOf(id);
  if (k >= 0) s.equipUsed.splice(k, 1); else { s.equipUsed.push(id); log(g, `${SURV[survivor].name}: ${cardName(g, id)} 사용`); }
};
A['hand.reveal'] = (g, seat) => { g.players[seat].handOpen = !g.players[seat].handOpen; };

// 덱에서 찾기(크로스로드 효과 등)
A['deck.fetch'] = (g, seat, { id, source }) => {
  const arr = source === 'waste' ? g.waste : source === 'removed' ? g.removed : fail('덱 없음');
  g.players[seat].hand.push(pluck(arr, id, '그 카드가 없습니다.'));
  log(g, `P${seat + 1}: ${source === 'waste' ? '쓰레기장' : '제거 더미'}에서 ${cardName(g, id)}을(를) 찾아 손에 넣음`);
};
A['waste.clean'] = (g, seat, { n }) => {
  n = n === 5 ? 5 : 3;
  const k = Math.min(n, g.waste.length);
  g.removed.push(...g.waste.splice(g.waste.length - k, k));
  log(g, `P${seat + 1}: 쓰레기 청소 · ${k}장 제거 (남은 쓰레기 ${g.waste.length})`);
};

// 크로스로드
function heldXr(g, seat, msg) { const x = g.xr; if (!x) fail('크로스로드 없음'); if (x.by !== seat) fail(msg); return x; }
function liveXr(g) { const x = g.xr; if (!x || !x.revealed) fail('발동된 크로스로드가 없습니다.'); return x; }
A['xr.reveal'] = (g, seat) => {
  const x = heldXr(g, seat, '크로스로드를 든 사람만 발동시킬 수 있습니다.');
  x.revealed = true;
  log(g, `⚡ 크로스로드 발동: 「${XR[x.id].name}」`);
};
A['xr.choose'] = (g, seat, { i }) => {
  const x = liveXr(g);
  const o = XR[x.id].options[i]; if (!o) fail('선택지 없음');
  x.chosen = i;
  log(g, `「${XR[x.id].name}」 → ${o.label}: ${o.effect}`);
  log(g, '효과는 보드에서 직접 적용하세요.');
};
A['xr.done'] = (g) => { liveXr(g); g.xr = null; };
A['xr.bottom'] = (g, seat) => {
  const x = heldXr(g, seat, '든 사람만');
  g.xrDeck.push(x.id); g.xr = null; log(g, '크로스로드를 덱 맨 아래로 돌려놓았습니다.');
};

// 위기
A['crisis.resolve'] = (g, seat) => {
  if (!g.crisis) fail('위기 없음');
  const c = CRISIS[g.crisis.id];
  const cards = shuffle(g.crisis.contrib.map((x) => x.id));
  let score = 0;
  const shown = cards.map((id) => {
    const k = TPL[g.cards[id].t].kind; const ok = c.need.includes(k);
    score += ok ? 1 : -1;
    return { id, ok };
  });
  const need = 2;
  const result = score < need ? 'fail' : score >= need + 2 ? 'bonus' : 'pass';
  g.removed.push(...cards);
  g.crisisResolved = { id: g.crisis.id, cards: shown, score, need, result };
  const tr = g.trace.at(-1); // 위기는 beginRound에서 기록과 함께 나오므로 항상 있다
  if (tr.crisis === g.crisis.id) tr.crisis_result = result;
  g.crisisPile.push(g.crisis.id);
  log(g, `위기 「${c.name}」 해결: ${shown.map((s) => cardName(g, s.id) + (s.ok ? '(+1)' : '(−1)')).join(', ') || '기여 없음'} → 점수 ${score} / 필요 ${need}`);
  if (result === 'fail') log(g, `✖ 위기 실패! 실패 효과를 적용하세요: ${c.fail}`);
  else if (result === 'bonus') { log(g, '✔ 위기를 막고 2장 초과 → 사기 +1'); changeMorale(g, 1); }
  else log(g, '✔ 위기를 막았습니다.');
  g.crisis = null;
  if (g.colonySteps) g.colonySteps.crisis = true;
};
A['crisis.skip'] = (g) => {
  if (!g.crisis) fail('위기 없음');
  g.crisisDeck.push(g.crisis.id);
  for (const x of g.crisis.contrib) g.players[x.by].hand.push(x.id);
  log(g, `위기 「${CRISIS[g.crisis.id].name}」를 덱 맨 아래로 보내고 이번 라운드 위기 해결을 건너뜁니다.`);
  g.crisis = null; if (g.colonySteps) g.colonySteps.crisis = true;
};

// 턴·단계
A['turn.end'] = (g, seat) => {
  if (g.stage !== 'player') fail('플레이어 턴 단계가 아닙니다.');
  if (g.turn !== seat) fail('자기 턴에만 턴을 마칠 수 있습니다.');
  endTurn(g);
};

A['colony.food'] = (g) => {
  const need = foodNeeded(g);
  if (g.food >= need) { g.food -= need; log(g, `식량 지불: ${need}개 (남은 식량 ${g.food})`); }
  else {
    g.starvation++;
    log(g, `식량 부족! 필요 ${need}, 보유 ${g.food} → 지불하지 않음 · 굶주림 토큰 ${g.starvation}개 → 사기 −${g.starvation}`);
    changeMorale(g, -g.starvation);
  }
  g.colonySteps.food = true;
};
A['colony.waste'] = (g) => {
  const per = g.wastePer || 10;
  const loss = Math.floor(g.waste.length / per);
  log(g, `쓰레기 확인: ${g.waste.length}장 → 사기 −${loss}`);
  if (loss) changeMorale(g, -loss);
  g.colonySteps.waste = true;
};
A['colony.zombies'] = (g) => {
  const pop = colonyPop(g);
  const cz = Math.ceil(pop / 2);
  if (cz) placeZombies(g, 'colony', cz, `피난기지 인원 ${pop}명`);
  for (const id of OUTSIDE) {
    const n = survivorsAt(g, id).length;
    if (n) placeZombies(g, id, n, `생존자 ${n}명`);
  }
  for (const id of OUTSIDE) {
    const l = g.locs[id];
    if (!l.noise) continue;
    const rolls = Array.from({ length: l.noise }, d6);
    const hits = rolls.filter((r) => r <= 3).length;
    log(g, `${LOC[id].name} 소음 ${l.noise}개 굴림: ${rolls.join(', ')} → 좀비 ${hits}마리`);
    l.noise = 0;
    if (hits) placeZombies(g, id, hits, '소음');
  }
  g.colonySteps.zombies = true;
};
A['colony.objective'] = (g, seat, { done }) => {
  g.colonySteps.objective = true;
  if (done) endGame(g, '공동목표를 달성했습니다.', true);
  else log(g, '공동목표 미달성 · 계속 진행');
};
A['colony.next'] = (g) => {
  if (g.stage !== 'colony') fail('피난기지 단계가 아닙니다.');
  g.round--;
  log(g, `라운드 마커 이동 → ${g.round}`);
  if (g.round <= 0) { endGame(g, '라운드가 0이 되었습니다.', false); return; }
  g.startPlayer = 1 - g.startPlayer;
  log(g, `시작 플레이어 토큰 → P${g.startPlayer + 1}`);
  g.colonySteps = null;
  for (const l of OUTSIDE) g.locs[l].searched = false;
  beginRound(g);
};
A['game.end'] = (g, seat, { win, why }) => { endGame(g, why || (win ? '공동목표 달성(수동)' : '게임 종료(수동)'), !!win); };
A['effect.add'] = (g, seat, { text }) => { if (text) { g.effects.push(String(text).slice(0, 120)); log(g, `진행 중 효과 추가: ${text}`); } };
A['effect.remove'] = (g, seat, { i }) => { const t = g.effects.splice(i, 1)[0]; if (t) log(g, `진행 중 효과 종료: ${t}`); };
A['setting.wastePer'] = (g, seat, { n }) => { g.wastePer = n === 15 ? 15 : 10; log(g, `쓰레기 기준: ${g.wastePer}장당 사기 −1`); };
A['chat'] = (g, seat, { text }) => { if (text) log(g, `💬 P${seat + 1}: ${String(text).slice(0, 200)}`); };


// ───────────────────────── 자동 판정 (시뮬레이터·참고용) ─────────────────────────

function startRounds(g) { return objectiveSide(g).rounds; }

// 공동목표 판정: { done, failed, progress(0~1) }
function checkObjective(g) {
  const o = g.settings.objective, hard = g.settings.side === 'hard';
  const side = objectiveSide(g);
  const under = g.underObjective.filter((c) => g.cards[c].o !== 'start');
  const cnt = (k) => under.filter((c) => TPL[g.cards[c].t].kind === k).length;
  const outsideZ = OUTSIDE.reduce((a, l) => a + g.locs[l].z, 0);
  const allOutsideBarr = OUTSIDE.every((l) => g.locs[l].b >= 1);
  const colonyB = g.locs.colony.entrances.reduce((a, e) => a + e.b, 0);
  const lastRound = g.round <= 1;
  const played = startRounds(g) - g.round + 1;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  switch (o) {
    case 'weeks': case 'mouths': {
      const extra = o === 'weeks' && hard ? g.food >= 6 : true;
      return { done: lastRound && extra, failed: false, progress: clamp(played / startRounds(g)) };
    }
    case 'winter': {
      const fuel = g.underObjective.filter((c) => TPL[g.cards[c].t].kind === 'fuel').length;
      return { done: lastRound && fuel >= side.target, failed: fuel < played, progress: clamp(fuel / side.target) };
    }
    case 'stockpile': {
      const per = hard ? 3 : 2;
      const parts = [Math.min(1, g.food / (per * 2)), g.locs.colony.entrances.filter((e) => e.b >= 1).length / LOC.colony.entrances,
        Math.min(1, cnt('medicine') / 2), Math.min(1, cnt('tool') / 2), Math.min(1, cnt('fuel') / 2)];
      return { done: parts.every((x) => x >= 1), failed: false, progress: parts.reduce((a, b) => a + b, 0) / parts.length };
    }
    case 'home': {
      const need = hard ? 14 : 10;
      const p = (Math.min(1, colonyB / need) + OUTSIDE.filter((l) => g.locs[l].b >= 1).length / 6) / 2;
      return { done: colonyB >= need && allOutsideBarr, failed: false, progress: p };
    }
    case 'kill': {
      const lim = hard ? 1 : 3;
      const ok = outsideZ <= lim && (!hard || allOutsideBarr);
      return { done: ok, failed: false, progress: clamp(1 - Math.max(0, outsideZ - lim) / 18) };
    }
    case 'raid': {
      const empty = OUTSIDE.filter((l) => g.locs[l].deck.length === 0).length;
      const left = OUTSIDE.map((l) => g.locs[l].deck.length).sort((a, b) => a - b);
      return { done: empty >= 2, failed: false, progress: clamp(1 - (left[0] + left[1]) / 40) };
    }
    case 'leave': {
      const need = (hard ? 3 : 2) * 2;
      const armed = [0, 1].filter((s) => Object.values(g.survivors).some((x) => x.owner === s && x.equip.some((c) => TPL[g.cards[c].t].kind === 'weapon'))).length;
      return { done: armed === 2 && cnt('food') >= need, failed: false, progress: (armed / 2 + Math.min(1, cnt('food') / need)) / 2 };
    }
    case 'cure': {
      const need = (hard ? 3 : 2) * 2;
      return { done: cnt('medicine') >= need, failed: false, progress: clamp(cnt('medicine') / need) };
    }
    case 'samples': {
      const need = side.targetPerPlayer * 2;
      return { done: g.samples >= need, failed: false, progress: clamp(g.samples / need) };
    }
  }
  return { done: false, failed: false, progress: 0 };
}

// 좀비 3마리씩 두 장소에 놓는 위기
const CRISIS_ZOMBIE_PAIRS = { watching: ['library', 'grocery'], march: ['school', 'police'], killer: ['hospital', 'gas'] };

// 위기 실패 효과 자동 적용 (선택이 필요한 부분은 정해진 기본값으로 처리)
function applyCrisisFail(g, cid) {
  const byInf = (asc) => Object.keys(g.survivors).sort((a, b) => (asc ? 1 : -1) * (SURV[a].inf - SURV[b].inf));
  const wound = (id, frost) => {
    const s = g.survivors[id];
    if (frost && !frostProof(g, id)) s.frost++; else s.wounds++;
    checkDeath(g, id);
  };
  const zombies = (loc, n) => placeZombies(g, loc, n, '위기 실패');
  log(g, `위기 실패 효과 자동 적용: ${CRISIS[cid].fail}`);
  switch (cid) {
    case 'overpop': byInf(true).slice(0, 2).forEach((id) => killSurvivor(g, id, '인구 과잉')); break;
    case 'exhaust': byInf(false).slice(0, 5).forEach((id) => wound(id, true)); break;
    case 'strength': g.locs.colony.entrances.forEach((e) => { e.b = 0; }); zombies('colony', 10); break;
    case 'watching': case 'march': case 'killer': CRISIS_ZOMBIE_PAIRS[cid].forEach((l) => zombies(l, 3)); break;
    case 'spoil': g.effects.push('식량 부패: 다음 라운드 끝까지 식량 토큰으로 주사위를 올릴 수 없음'); changeMorale(g, -1); break;
    case 'hail':
      for (let s = 0; s < 2; s++) {
        const r = d6(); const mine = byInf(true).filter((id) => g.survivors[id].owner === s);
        log(g, `우박 폭풍: P${s + 1} 주사위 ${r}`);
        if (r <= 4 && mine[0]) wound(mine[0], true);
      }
      g.locs.colony.entrances.forEach((e) => { e.b = 0; }); OUTSIDE.forEach((l) => { g.locs[l].b = 0; });
      break;
    case 'despair': case 'fuelshort': case 'horror': changeMorale(g, -2); break;
    case 'hordes': zombies('colony', 8); changeMorale(g, -1); break;
    case 'starve': g.starvation++; changeMorale(g, -1); break;
    case 'legions': zombies('colony', 12); break;
    case 'blizzard': g.effects.push('눈보라: 다음 라운드 끝까지 이동 불가'); changeMorale(g, -1); break;
    case 'illness': Object.keys(g.survivors).forEach((id) => wound(id, false)); changeMorale(g, -1); break;
    case 'shaking':
      for (let s = 0; s < 2; s++) { const mine = byInf(true).filter((id) => g.survivors[id].owner === s && !g.survivors[id].leader); if (mine[0]) g.survivors[mine[0]].owner = 1 - s; }
      changeMorale(g, -1); break;
    case 'raiders': for (const p of g.players) if (p.hand.length) g.removed.push(p.hand.splice(rnd(p.hand.length), 1)[0]); changeMorale(g, -1); break;
    case 'wastenot': { const f = g.removed.filter((c) => TPL[g.cards[c].t].kind === 'food'); g.removed = g.removed.filter((c) => !f.includes(c)); g.waste.push(...f); changeMorale(g, -1); break; }
    case 'surge': zombies('colony', 6); OUTSIDE.forEach((l) => zombies(l, 1)); break;
  }
}

A['crisis.autoFail'] = (g) => {
  const r = g.crisisResolved;
  if (!r || r.result !== 'fail' || r.applied) fail('적용할 위기 실패 효과가 없습니다.');
  r.applied = true;
  applyCrisisFail(g, r.id);
};

// ───────────────────────── 학습 데이터 기록 ─────────────────────────

const featCtx = {
  TPL, LOC, SURV,
  foodNeeded,
  crisisNeed: (id) => CRISIS[id].need,
  objectiveProgress: (g) => checkObjective(g).progress,
};
function snapshotRound(g) {
  g.trace.push({ round: g.round, morale0: g.morale, crisis: g.crisis.id, x: FEAT.extract(g, { ...featCtx, startRounds: startRounds(g) }), crisis_result: null });
}

// 게임 한 판 → 라운드별 학습 행(JSONL 용)
function exportRows(g, source, meta = {}) {
  if (g.phase !== 'ended') return [];
  const T = g.trace;
  return T.map((t, i) => ({
    schema: FEAT.SCHEMA_VERSION, source, game_id: g.id, round_index: i, round: t.round,
    objective: g.settings.objective, side: g.settings.side,
    x: t.x,
    y_win: g.end.win ? 1 : 0,
    y_crisis: t.crisis_result == null ? null : t.crisis_result === 'fail' ? 0 : 1,
    // 이 라운드가 끝나기 전에 게임이 패배로 무너졌는가 (마지막 라운드 기록이고 패배로 끝남)
    y_collapse: i === T.length - 1 && !g.end.win && g.end.round === t.round ? 1 : 0,
    y_morale_delta: (i < T.length - 1 ? T[i + 1].morale0 : g.morale) - t.morale0,
    pred: t.pred || null,
    end_reason: g.end.why, ...meta,
  }));
}

function apply(g, seat, type, payload) {
  const fn = A[type];
  if (!fn) fail('알 수 없는 액션: ' + type);
  if (g.phase === 'ended' && type !== 'chat') fail('게임이 끝났습니다.');
  if (g.phase === 'setup' && !type.startsWith('setup.') && type !== 'chat') fail('먼저 생존자를 고르세요.');
  fn(g, seat, payload || {});
}

// ───────────────────────── 시점별 공개 정보 ─────────────────────────

function viewFor(g, seat) {
  const v = clone(g);
  const lastTrace = g.trace.at(-1);
  v.pred = g.phase === 'play' && lastTrace && lastTrace.pred ? { round: lastTrace.round, ...lastTrace.pred } : null;
  delete v.trace;
  v.objectiveAuto = checkObjective(g);
  // 덱 내용 숨기기(장수만)
  for (const id of OUTSIDE) { v.locs[id].deckCount = g.locs[id].deck.length; delete v.locs[id].deck; }
  for (const k of ['crisisDeck', 'survivorDeck', 'xrDeck']) { v[k + 'Count'] = g[k].length; delete v[k]; }
  v.players = g.players.map((p, i) => {
    const mine = i === seat;
    const showHand = mine || p.handOpen;
    return {
      hand: showHand ? p.hand : null, handCount: p.hand.length, handOpen: p.handOpen,
      dice: p.dice, ready: p.ready, needLeader: !!p.needLeader,
      dealtSurvivors: mine ? p.dealtSurvivors : [], picked: mine ? p.picked : [], leader: mine ? p.leader : null,
      search: mine ? p.search : (p.search ? { loc: p.search.loc, count: p.search.cards.length } : null),
    };
  });
  if (g.crisis) v.crisis = { id: g.crisis.id, count: g.crisis.contrib.length, mine: g.crisis.contrib.filter((x) => x.by === seat).map((x) => x.id) };
  if (g.xr) {
    const canSee = g.xr.revealed || g.xr.by === seat;
    v.xr = { for: g.xr.for, by: g.xr.by, revealed: g.xr.revealed, chosen: g.xr.chosen, id: canSee ? g.xr.id : null };
  }
  v.calc = {
    colonyPop: colonyPop(g),
    foodNeeded: foodNeeded(g), colonyZombiesNext: Math.ceil(colonyPop(g) / 2),
    wasteLoss: Math.floor(g.waste.length / (g.wastePer || 10)),
  };
  return v;
}

module.exports = { DATA, newGame, setupGame, apply, viewFor, GameError, OBJ, checkObjective, exportRows, FEAT, TPL, SURV, LOC, CRISIS, survivorsAt, locOccupancy };
