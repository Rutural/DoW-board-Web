'use strict';
// 규칙 기반 봇: 엔진 액션(G.apply)만 써서 사람처럼 한 판을 진행한다.
// skill(0~1): 낮을수록 행동을 건너뛰어 서툰 플레이를 흉내 낸다 → 상태 분포를 넓힌다.

const { OUTSIDE, critical: isCritical } = require('./features');

const BOT_VERSION = 'heuristic-4';

function makeBot(G, { skill = 1, rand = Math.random } = {}) {
  const { TPL, SURV, LOC, CRISIS } = G;
  const act = (g, s, type, p) => { try { G.apply(g, s, type, p || {}); return true; } catch (e) { if (e instanceof G.GameError) return false; throw e; } };
  const alive = (g) => g.phase === 'play';
  const maybe = () => rand() < skill;
  const kind = (g, c) => TPL[g.cards[c].t].kind;
  const isStart = (g, c) => g.cards[c].o === 'start';
  const crisisNeed = (g) => (g.crisis ? CRISIS[g.crisis.id].need : []);
  const critical = (g, id) => isCritical(g.survivors[id], SURV[id]);

  // 목표에 필요한 카드(목표 아래에 놓을 카드)
  function objectiveWants(g, c) {
    const o = g.settings.objective, k = kind(g, c);
    if (o === 'winter') return k === 'fuel';
    if (isStart(g, c)) return false;
    const under = g.underObjective.filter((x) => !isStart(g, x));
    const n = (kk) => under.filter((x) => kind(g, x) === kk).length;
    const hard = g.settings.side === 'hard';
    if (o === 'cure') return k === 'medicine' && n('medicine') < (hard ? 6 : 4);
    if (o === 'leave') return k === 'food' && n('food') < (hard ? 6 : 4);
    if (o === 'stockpile') return ['medicine', 'tool', 'fuel'].includes(k) && n(k) < 2;
    return false;
  }

  function dice(g, s) { return g.players[s].dice.map((d, i) => ({ ...d, i })).filter((d) => !d.used); }
  function takeDie(g, s, min) {
    const ok = dice(g, s).filter((d) => d.v >= min).sort((a, b) => a.v - b.v)[0];
    if (!ok) return false;
    return act(g, s, 'dice.use', { i: ok.i });
  }
  function anyDie(g, s) { const d = dice(g, s).sort((a, b) => a.v - b.v)[0]; return d ? act(g, s, 'dice.use', { i: d.i }) : false; }
  const mine = (g, s) => Object.keys(g.survivors).filter((id) => g.survivors[id].owner === s);
  const at = (g, loc) => Object.keys(g.survivors).filter((id) => g.survivors[id].loc === loc);
  const zAt = (g, loc) => (loc === 'colony' ? g.locs.colony.entrances.reduce((a, e) => a + e.z, 0) : g.locs[loc].z);
  const occ = (g, loc) => at(g, loc).length + (loc === 'colony' ? g.helpless : 0);

  // 다음 피난기지 단계에 이 장소에 추가될 좀비 수
  function nextAdds(g, loc) {
    if (loc === 'colony') return Math.ceil(occ(g, 'colony') / 2);
    return at(g, loc).length + Math.ceil(g.locs[loc].noise / 2);
  }
  // 침입 위험이 있는 피난기지 입구 번호들 (좀비는 입구 1부터 차례로 들어온다)
  function riskyEntrances(g) {
    const adds = nextAdds(g, 'colony'); const es = g.locs.colony.entrances; const out = [];
    for (let i = 0; i < 6; i++) { const inc = Math.floor(adds / 6) + (i < adds % 6 ? 1 : 0); if (inc && es[i].z + inc > 3) out.push(i); }
    return out;
  }
  function outsideRisk(g, loc) { const l = g.locs[loc]; return l.z + nextAdds(g, loc) - (LOC[loc].entranceSlots - l.b); }
  const foodNeedNext = (g) => Math.ceil(occ(g, 'colony') / 2);
  const foodLow = (g) => g.food + g.players.flatMap((p) => p.hand).filter((c) => kind(g, c) === 'food').length * 1.5 < foodNeedNext(g) * 2;

  function cardScore(g, c) {
    const k = kind(g, c);
    const need = crisisNeed(g);
    let sc = { food: 2, medicine: 2, weapon: 2, outsider: 1.5, tool: 1, fuel: 1, book: 0.8 }[k] || 1;
    if (need.includes(k)) sc += 2.5;
    if (objectiveWants(g, c)) sc += 4;
    if (k === 'food' && foodLow(g)) sc += 3;
    if (k === 'outsider' && (occ(g, 'colony') > 15 || foodLow(g))) sc -= 2;
    return sc + rand() * 0.3;
  }

  function killWith(g, s, id, entrance) {
    const loc = g.survivors[id].loc;
    const before = zAt(g, loc);
    act(g, s, 'zombie.kill', { loc, survivor: id, n: 1, exposure: id !== 'mike', entrance });
    const killed = before - zAt(g, loc);
    if (g.settings.objective === 'samples') {
      for (let i = 0; i < killed; i++) if (1 + Math.floor(rand() * 6) >= 4) act(g, s, 'track', { key: 'samples', d: 1 });
    }
  }

  function moveTo(g, s, id, to) {
    if (!g.survivors[id] || g.survivors[id].moved || g.survivors[id].loc === to) return false;
    if (occ(g, to) >= LOC[to].slots) return false;
    if (g.effects.some((e) => e.startsWith('눈보라'))) return false;
    // 연료는 위기·목표용으로 아끼고, 넉넉할 때만 이동에 쓴다
    const fuels = g.players[s].hand.filter((c) => g.cards[c].t === 'fuel' && !objectiveWants(g, c));
    const crisisWantsFuel = crisisNeed(g).includes('fuel');
    const fuel = !crisisWantsFuel && g.settings.objective !== 'winter' && fuels.length >= 3 ? fuels[0] : null;
    if (fuel && id !== 'rod') { act(g, s, 'card.waste', { id: fuel }); return act(g, s, 'surv.move', { id, to, exposure: 'fuel' }); }
    return act(g, s, 'surv.move', { id, to, exposure: id === 'rod' ? 'none' : 'roll' });
  }

  function search(g, s, id) {
    const sv = SURV[id]; const loc = g.survivors[id] && g.survivors[id].loc;
    if (!loc || loc === 'colony' || !g.locs[loc].deck.length) return false;
    if (!takeDie(g, s, sv.srch)) return false;
    if (!act(g, s, 'search.start', { loc, survivor: id })) return false;
    const p = g.players[s];
    // 첫 장이 별로면 소음을 내고 한 장 더
    if (cardScore(g, p.search.cards[0]) < 3 && g.locs[loc].noise < 2 && g.locs[loc].deck.length && maybe()) act(g, s, 'search.more', { noise: true });
    const best = [...p.search.cards].sort((a, b) => cardScore(g, b) - cardScore(g, a))[0];
    return act(g, s, 'search.take', { ids: [best] });
  }

  function handlePending(g, s) {
    let guard = 0;
    while (alive(g) && guard++ < 20) {
      if (g.pendingBite) { act(g, s, 'bite.resolve', { choice: 'roll' }); continue; }
      if (g.pendingOverrun) { act(g, s, 'overrun.clear'); continue; }
      for (let q = 0; q < 2; q++) if (g.players[q].needLeader) {
        const best = mine(g, q).sort((a, b) => SURV[b].inf - SURV[a].inf)[0];
        if (best) act(g, q, 'surv.leader', { id: best });
      }
      break;
    }
  }

  function pickSurvivors(g, s) {
    const dealt = g.players[s].dealtSurvivors;
    const picked = [...dealt].sort((a, b) => (SURV[a].atk + SURV[a].srch) - (SURV[b].atk + SURV[b].srch) + (rand() - 0.5) * 2 * (1 - skill) * 4).slice(0, 3);
    const leader = [...picked].sort((a, b) => SURV[b].inf - SURV[a].inf)[0];
    act(g, s, 'setup.pick', { picked, leader });
  }

  function playTurn(g, s) {
    const p = g.players[s];
    handlePending(g, s);
    if (!alive(g)) return;

    // 1) 목표 아래에 놓기 (겨울이 왔다는 피난기지 단계에서 놓음)
    if (g.settings.objective !== 'winter') for (const c of [...p.hand]) if (objectiveWants(g, c) && maybe()) act(g, s, 'card.objective', { id: c });

    // 2) 치료
    for (const id of mine(g, s)) {
      const sv = g.survivors[id]; if (!sv) continue;
      const crisisMed = crisisNeed(g).includes('medicine');
      const meds = p.hand.filter((c) => g.cards[c].t === 'medicine' && !objectiveWants(g, c));
      if (critical(g, id) || (sv.wounds + sv.frost >= 1 && sv.frost > 0 && meds.length > (crisisMed ? 2 : 0))) {
        const med = meds[0];
        if (med && maybe()) { act(g, s, 'card.play', { id: med }); act(g, s, 'surv.wound', { id, kind: sv.frost ? 'frost' : 'wound', d: -1 }); }
      }
    }

    // 3) 위기 기여 (필요 2점 + 여유 1장)
    if (g.crisis) {
      const need = crisisNeed(g);
      const cands = p.hand.filter((c) => need.includes(kind(g, c)) && !objectiveWants(g, c)).sort((a, b) => isStart(g, b) - isStart(g, a));
      for (const c of cands) { if (g.crisis.contrib.length >= 3 || !maybe()) break; act(g, s, 'card.contribute', { id: c }); }
    }

    // 4) 식량 카드: 필요량 대비 부족하면 사용
    for (const c of [...p.hand]) if (kind(g, c) === 'food' && g.food < foodNeedNext(g) + 1 && !objectiveWants(g, c) && maybe()) act(g, s, 'card.play', { id: c });

    // 5) 외부인, 장착 카드
    for (const c of [...p.hand]) {
      const t = TPL[g.cards[c].t];
      if (t.use === 'event' && occ(g, 'colony') <= 15 && !foodLow(g) && g.food >= foodNeedNext(g) + 2 && maybe()) act(g, s, 'card.play', { id: c });
      else if (t.use === 'equip' && maybe()) {
        const who = mine(g, s).sort((a, b) => (t.kind === 'weapon' ? SURV[a].atk - SURV[b].atk : g.survivors[a].equip.length - g.survivors[b].equip.length))[0];
        if (who) act(g, s, 'card.play', { id: c, target: who });
      }
    }

    // 6) 주사위 행동
    const o = g.settings.objective;
    // 피난기지 방어: 다음 배치에서 침입이 날 입구부터 처치, 안 되면 바리케이드
    const defenders = () => at(g, 'colony').filter((x) => g.survivors[x].owner === s).sort((a, b) => SURV[a].atk - SURV[b].atk);
    let guard = 0;
    while (alive(g) && guard++ < 12 && maybe()) {
      const risky = riskyEntrances(g).filter((i) => g.locs.colony.entrances[i].z > 0);
      if (!risky.length) break;
      const d = defenders().find((x) => dice(g, s).some((dd) => dd.v >= SURV[x].atk));
      if (!d || !takeDie(g, s, SURV[d].atk)) break;
      killWith(g, s, d, risky[0]);
      handlePending(g, s);
    }
    if (o === 'kill' || o === 'samples') for (const id of defenders()) {
      while (alive(g) && g.survivors[id] && zAt(g, 'colony') > 0 && dice(g, s).length > 1 && takeDie(g, s, SURV[id].atk)) { killWith(g, s, id); handlePending(g, s); }
    }
    // 목표별 사냥
    if (o === 'kill' || o === 'samples') {
      const hunter = mine(g, s).filter((x) => g.survivors[x].wounds + g.survivors[x].frost < 2).sort((a, b) => SURV[a].atk - SURV[b].atk)[0];
      if (hunter) {
        const target = OUTSIDE.filter((l) => g.locs[l].z > 0 && occ(g, l) < LOC[l].slots).sort((a, b) => g.locs[b].z - g.locs[a].z)[0];
        if (target && g.survivors[hunter].loc !== target) { moveTo(g, s, hunter, target); handlePending(g, s); }
        while (alive(g) && g.survivors[hunter] && g.survivors[hunter].loc !== 'colony' && zAt(g, g.survivors[hunter].loc) > 0 && takeDie(g, s, SURV[hunter].atk)) { killWith(g, s, hunter); handlePending(g, s); }
      }
    }
    // 탐색조: 리더가 아닌 생존자를 밖으로
    for (const id of mine(g, s).sort((a, b) => SURV[a].srch - SURV[b].srch)) {
      if (!alive(g) || !g.survivors[id]) continue;
      const sv = g.survivors[id];
      if (critical(g, id)) { if (sv.loc !== 'colony' && maybe()) moveTo(g, s, id, 'colony'); continue; }
      const outsideMine = mine(g, s).filter((x) => g.survivors[x].loc !== 'colony').length;
      if (sv.loc === 'colony' && outsideMine < 2 && SURV[id].srch <= 4 && (!sv.leader || mine(g, s).length === 1) && maybe()) {
        const foodPlace = { grocery: 2, school: 1.5, library: 0.5, hospital: 0.5, police: 0.3, gas: 0.3 };
        const need = crisisNeed(g);
        const fit = (l) => (foodLow(g) ? foodPlace[l] * 2 : 0) + (need.some((k) => LOC[l].symbols.split('>')[0].includes({ food: '식량', fuel: '연료', medicine: '약', tool: '도구' }[k])) ? 1.5 : 0);
        const dest = OUTSIDE.filter((l) => g.locs[l].deck.length > 0 && occ(g, l) < LOC[l].slots && outsideRisk(g, l) < 0)
          .sort((a, b) => (g.locs[a].z - g.locs[b].z) * 0.7 - (fit(a) - fit(b)) + (o === 'raid' ? (g.locs[a].deck.length - g.locs[b].deck.length) * 0.2 : 0) + (rand() - 0.5))[0];
        if (dest) { moveTo(g, s, id, dest); handlePending(g, s); }
      }
      let n = 0;
      while (alive(g) && g.survivors[id] && g.survivors[id].loc !== 'colony' && n++ < 3 && maybe()) {
        if (!search(g, s, id)) break;
      }
      // 다음 배치에서 침입 위험이면: 처치 → 바리케이드 → 귀환
      let gg = 0;
      while (alive(g) && g.survivors[id] && g.survivors[id].loc !== 'colony' && outsideRisk(g, g.survivors[id].loc) >= 0 && gg++ < 6) {
        const loc = g.survivors[id].loc;
        if (g.locs[loc].z > 0 && takeDie(g, s, SURV[id].atk)) { killWith(g, s, id); handlePending(g, s); continue; }
        if (g.locs[loc].z + g.locs[loc].b < LOC[loc].entranceSlots && anyDie(g, s)) { act(g, s, 'barricade', { loc, d: 1 }); continue; }
        if (!g.survivors[id].moved) { moveTo(g, s, id, 'colony'); handlePending(g, s); }
        break;
      }
    }
    // 남은 주사위: 쓰레기 청소 / 바리케이드
    while (alive(g) && dice(g, s).length) {
      if (g.waste.length >= 8 && mine(g, s).some((x) => g.survivors[x].loc === 'colony') && anyDie(g, s)) { act(g, s, 'waste.clean', { n: 3 }); continue; }
      if (!maybe()) { anyDie(g, s); continue; }
      const outLoc = mine(g, s).map((x) => g.survivors[x].loc).find((l) => l !== 'colony' && g.locs[l].z + g.locs[l].b < LOC[l].entranceSlots && (o === 'home' ? g.locs[l].b < 1 : outsideRisk(g, l) >= -1));
      const es = g.locs.colony.entrances;
      const adds = nextAdds(g, 'colony');
      const ent = [...Array(6).keys()].filter((i) => es[i].z + es[i].b < 3).sort((a, b) => ((a < adds ? 0 : 10) + es[a].b) - ((b < adds ? 0 : 10) + es[b].b))[0];
      const ok = outLoc && rand() < 0.5 ? act(g, s, 'barricade', { loc: outLoc, d: 1 }) : ent != null && act(g, s, 'barricade', { loc: 'colony', d: 1, entrance: ent });
      anyDie(g, s);
      if (!ok && !dice(g, s).length) break;
    }
    handlePending(g, s);
    if (alive(g)) act(g, s, 'turn.end');
  }

  function colonyPhase(g) {
    const s = g.startPlayer;
    handlePending(g, s);
    if (g.settings.objective === 'winter') {
      for (let q = 0; q < 2; q++) {
        const f = g.players[q].hand.find((c) => kind(g, c) === 'fuel');
        if (f) { act(g, q, 'card.objective', { id: f }); break; }
      }
      if (G.checkObjective(g).failed) { act(g, s, 'game.end', { win: false, why: '겨울이 왔다: 연료를 놓지 못했습니다.' }); return; }
    }
    for (const step of ['colony.food', 'colony.waste', 'crisis.resolve']) { if (!alive(g)) return; act(g, s, step); handlePending(g, s); }
    if (alive(g) && g.crisisResolved && g.crisisResolved.result === 'fail') { act(g, s, 'crisis.autoFail'); handlePending(g, s); }
    if (!alive(g)) return;
    act(g, s, 'colony.zombies'); handlePending(g, s);
    if (!alive(g)) return;
    act(g, s, 'colony.objective', { done: G.checkObjective(g).done });
    if (alive(g)) act(g, s, 'colony.next');
  }

  function playGame(g, maxSteps = 400) {
    for (let s = 0; s < 2; s++) pickSurvivors(g, s);
    let steps = 0;
    while (alive(g) && steps++ < maxSteps) {
      if (g.stage === 'player') playTurn(g, g.turn);
      else colonyPhase(g);
    }
    return g;
  }

  return { playGame, playTurn, colonyPhase };
}

module.exports = { makeBot, BOT_VERSION };
