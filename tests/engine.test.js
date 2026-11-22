'use strict';
// 엔진 규칙 단위 테스트
const test = require('node:test');
const assert = require('node:assert/strict');
const { G, playing, cardsOfKind, colonySurvivors } = require('./helpers');

test('2인 협력 준비: 손패 7장, 생존자 3명씩, 주사위 1+생존자 수', () => {
  const g = playing();
  assert.equal(g.phase, 'play');
  for (const s of [0, 1]) {
    assert.equal(g.players[s].hand.length, 7);
    assert.equal(Object.values(g.survivors).filter((x) => x.owner === s).length, 3);
    assert.equal(g.players[s].dice.length, 4);
  }
  assert.ok(g.crisis && g.crisis.id, '첫 위기가 공개되어야 함');
  assert.ok(g.xr, '첫 턴에 크로스로드가 뽑혀 있어야 함');
});

test('비협력 생존자와 비협력 크로스로드는 덱에서 빠진다', () => {
  const g = G.newGame({ objective: 'samples' }); G.setupGame(g);
  const all = [...g.survivorDeck, ...g.players.flatMap((p) => p.dealtSurvivors)];
  assert.ok(!all.includes('graybeard') && !all.includes('annaleigh'));
  const excluded = G.DATA.crossroads.filter((c) => c.tags.includes('비협력') || c.tags.includes('성인 테마')).length;
  assert.equal(g.xrDeck.length + (g.xr ? 1 : 0), 80 - excluded); // 비협력·성인 테마(기본값 제외) 카드 빠짐
  assert.ok(g.xrDeck.every((id) => !G.DATA.crossroads.find((c) => c.id === id).tags.includes('비협력')));
});

test('피난기지 좀비는 매 효과마다 입구 1부터 순서대로 놓인다', () => {
  const g = playing();
  g.locs.colony.entrances.forEach((e) => { e.z = 0; e.b = 0; });
  G.apply(g, 0, 'zombie', { loc: 'colony', d: 7 });
  assert.deepEqual(g.locs.colony.entrances.map((e) => e.z), [2, 1, 1, 1, 1, 1]);
  G.apply(g, 0, 'zombie', { loc: 'colony', d: 1 });
  assert.equal(g.locs.colony.entrances[0].z, 3, '다음 효과도 입구 1부터');
});

test('칸이 가득 찬 입구에 좀비가 오면 바리케이드가 부서진다', () => {
  const g = playing();
  g.locs.colony.entrances.forEach((e) => { e.z = 0; e.b = 0; });
  g.locs.colony.entrances[0] = { z: 2, b: 1 };
  G.apply(g, 0, 'zombie', { loc: 'colony', d: 1 });
  assert.deepEqual(g.locs.colony.entrances[0], { z: 2, b: 0 });
});

test('침입: 영향력이 가장 낮은 생존자가 죽고 사기 −1', () => {
  const g = playing();
  g.locs.colony.entrances.forEach((e) => { e.z = 3; e.b = 0; });
  const low = colonySurvivors(g).sort((a, b) => G.SURV[a].inf - G.SURV[b].inf)[0];
  const morale = g.morale;
  G.apply(g, 0, 'zombie', { loc: 'colony', d: 1 });
  assert.ok(!g.survivors[low], '최저 영향력 생존자가 제거되어야 함');
  assert.equal(g.morale, morale - 1);
  assert.deepEqual(g.pendingOverrun.victims, [G.SURV[low].name]);
});

test('식량 부족: 지불하지 않고 굶주림 토큰 누적만큼 사기 감소', () => {
  const g = playing();
  g.stage = 'colony'; g.colonySteps = {}; g.food = 0; g.morale = 8;
  G.apply(g, 0, 'colony.food');
  assert.equal(g.starvation, 1); assert.equal(g.morale, 7);
  g.colonySteps = {};
  G.apply(g, 0, 'colony.food');
  assert.equal(g.starvation, 2); assert.equal(g.morale, 5);
});

test('식량이 충분하면 ⌈(피난기지 인원)/2⌉만큼 지불', () => {
  const g = playing();
  g.stage = 'colony'; g.colonySteps = {}; g.food = 10;
  const pop = colonySurvivors(g).length + g.helpless;
  G.apply(g, 0, 'colony.food');
  assert.equal(g.food, 10 - Math.ceil(pop / 2));
  assert.equal(g.starvation, 0);
});

test('위기 판정(2인): 2점 성공, 4점 사기 +1, 틀린 종류는 −1', () => {
  const run = (kinds) => {
    const g = playing();
    g.morale = 5;
    const used = {};
    const contrib = kinds.map((k) => { used[k] = (used[k] || 0) + 1; return { id: cardsOfKind(g, k, used[k])[used[k] - 1], by: 0 }; });
    g.crisis = { id: 'despair', contrib }; // 절망: 약
    G.apply(g, 0, 'crisis.resolve');
    return { r: g.crisisResolved, morale: g.morale };
  };
  assert.equal(run(['medicine', 'medicine']).r.result, 'pass');
  const bonus = run(['medicine', 'medicine', 'medicine', 'medicine']);
  assert.equal(bonus.r.result, 'bonus'); assert.equal(bonus.morale, 6);
  const bad = run(['medicine', 'food']);
  assert.equal(bad.r.score, 0); assert.equal(bad.r.result, 'fail');
});

test('위기 실패 효과 자동 적용 (절망: 사기 −2)', () => {
  const g = playing();
  g.morale = 6; g.crisis = { id: 'despair', contrib: [] };
  G.apply(g, 0, 'crisis.resolve');
  G.apply(g, 0, 'crisis.autoFail');
  assert.equal(g.morale, 4);
  assert.throws(() => G.apply(g, 0, 'crisis.autoFail'), G.GameError, '두 번 적용할 수 없음');
});

test('부상 3개(동상 포함)면 사망, 버디는 4개', () => {
  const g = playing();
  const id = Object.keys(g.survivors)[0];
  g.survivors[id].wounds = 2;
  G.apply(g, 0, 'surv.wound', { id, kind: 'frost', d: 1 });
  if (id === 'buddy') assert.ok(g.survivors[id]); else assert.ok(!g.survivors[id]);
});

test('사기는 0 미만으로 내려가지 않고 0이 되면 즉시 종료', () => {
  const g = playing();
  g.morale = 1;
  G.apply(g, 0, 'track', { key: 'morale', d: -3 });
  assert.equal(g.morale, 0);
  assert.equal(g.phase, 'ended');
  assert.equal(g.end.win, false);
});

test('공동목표 자동 판정: 샘플 목표', () => {
  const g = playing({ objective: 'samples', side: 'hard' });
  assert.equal(G.checkObjective(g).done, false);
  g.samples = 8;
  assert.equal(G.checkObjective(g).done, true);
  assert.equal(G.checkObjective(g).progress, 1);
});

test('공동목표 자동 판정: 치료제(시작 아이템은 세지 않음)', () => {
  const g = playing({ objective: 'cure', side: 'normal' });
  const starts = Object.keys(g.cards).filter((c) => g.cards[c].o === 'start' && G.TPL[g.cards[c].t].kind === 'medicine');
  const loc = Object.keys(g.cards).filter((c) => g.cards[c].o !== 'start' && G.TPL[g.cards[c].t].kind === 'medicine');
  g.underObjective = starts.slice(0, 4);
  assert.equal(G.checkObjective(g).done, false);
  g.underObjective = loc.slice(0, 4);
  assert.equal(G.checkObjective(g).done, true);
});

test('시점별 정보: 상대 손패와 상대가 든 크로스로드는 보이지 않는다', () => {
  const g = playing();
  const by = g.xr.by, other = 1 - by;
  const v = G.viewFor(g, other);
  assert.equal(v.players[by].hand, null);
  assert.equal(v.xr.id, null);
  assert.ok(Array.isArray(G.viewFor(g, by).players[by].hand));
  assert.equal(v.trace, undefined, '학습 기록은 화면으로 보내지 않음');
});

test('학습 기록: 라운드마다 특징값, 종료 시 라벨', () => {
  const g = playing();
  assert.equal(g.trace.length, 1);
  assert.equal(g.trace[0].x.length, G.FEAT.FEATURE_NAMES.length);
  assert.ok(g.trace[0].x.every(Number.isFinite));
  assert.deepEqual(G.exportRows(g, 'test'), [], '끝나지 않은 게임은 내보내지 않음');
  G.apply(g, 0, 'game.end', { win: false, why: '테스트' });
  const rows = G.exportRows(g, 'test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].y_win, 0);
  assert.equal(rows[0].y_collapse, 1);
  assert.equal(rows[0].schema, G.FEAT.SCHEMA_VERSION);
});
