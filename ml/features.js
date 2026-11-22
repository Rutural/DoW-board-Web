'use strict';
// 라운드 시작 상태 → 특징값 벡터.
// 학습(시뮬레이터·실제 로그 생성)과 서빙(모델 API 입력)에서 이 파일 하나만 쓴다 → parity의 기준.

const SCHEMA_VERSION = 1;
const KINDS = ['weapon', 'fuel', 'book', 'food', 'medicine', 'tool', 'outsider'];
const NEED_KINDS = ['food', 'fuel', 'medicine', 'tool'];
const OBJECTIVES = ['winter', 'weeks', 'stockpile', 'home', 'kill', 'mouths', 'raid', 'leave', 'cure', 'samples'];
const OUTSIDE = ['police', 'grocery', 'school', 'library', 'hospital', 'gas'];

const FEATURE_NAMES = [
  'rounds_left', 'rounds_played', 'morale', 'food', 'starvation', 'helpless',
  'colony_pop', 'colony_free', 'food_needed', 'food_deficit',
  'colony_zombies', 'colony_barricades', 'colony_entrance_free',
  'outside_zombies', 'outside_barricades', 'outside_noise',
  'survivors', 'survivors_outside', 'wounds', 'frost', 'survivors_critical',
  'dice_total', 'dice_mean',
  'hand_total', ...KINDS.map((k) => 'hand_' + k), 'hand_crisis_match', 'hand_nonstart',
  'equipped', 'equipped_weapons',
  'waste', 'waste_next_penalty_in',
  'decks_remaining', 'decks_empty',
  ...NEED_KINDS.map((k) => 'crisis_need_' + k),
  ...OBJECTIVES.map((o) => 'obj_' + o), 'obj_hard', 'obj_progress', 'under_objective', 'samples',
];

/**
 * @param g    게임 상태
 * @param ctx  { TPL, LOC, SURV, objectiveSide(g), objectiveProgress(g), foodNeeded(g), crisisNeed(id), startRounds }
 */
function extract(g, ctx) {
  const { TPL, LOC, SURV } = ctx;
  const surv = Object.entries(g.survivors);
  const colonySurv = surv.filter(([, s]) => s.loc === 'colony').length;
  const colonyPop = colonySurv + g.helpless;
  const ents = g.locs.colony.entrances;
  const kindOf = (id) => TPL[g.cards[id].t].kind;
  const hands = g.players.flatMap((p) => p.hand);
  const need = g.crisis ? ctx.crisisNeed(g.crisis.id) : [];
  const dice = g.players.flatMap((p) => p.dice);
  const equip = surv.flatMap(([, s]) => s.equip);
  const decks = OUTSIDE.map((l) => (g.locs[l].deck ? g.locs[l].deck.length : g.locs[l].deckCount || 0));
  const foodNeeded = ctx.foodNeeded(g);
  const f = {
    rounds_left: g.round,
    rounds_played: ctx.startRounds - g.round,
    morale: g.morale,
    food: g.food,
    starvation: g.starvation,
    helpless: g.helpless,
    colony_pop: colonyPop,
    colony_free: LOC.colony.slots - colonyPop,
    food_needed: foodNeeded,
    food_deficit: Math.max(0, foodNeeded - g.food),
    colony_zombies: ents.reduce((a, e) => a + e.z, 0),
    colony_barricades: ents.reduce((a, e) => a + e.b, 0),
    colony_entrance_free: ents.reduce((a, e) => a + (3 - e.z - e.b), 0),
    outside_zombies: OUTSIDE.reduce((a, l) => a + g.locs[l].z, 0),
    outside_barricades: OUTSIDE.reduce((a, l) => a + g.locs[l].b, 0),
    outside_noise: OUTSIDE.reduce((a, l) => a + g.locs[l].noise, 0),
    survivors: surv.length,
    survivors_outside: surv.length - colonySurv,
    wounds: surv.reduce((a, [, s]) => a + s.wounds, 0),
    frost: surv.reduce((a, [, s]) => a + s.frost, 0),
    survivors_critical: surv.filter(([id, s]) => s.wounds + s.frost >= (SURV[id].maxWounds || 3) - 1).length,
    dice_total: dice.length,
    dice_mean: dice.length ? dice.reduce((a, d) => a + d.v, 0) / dice.length : 0,
    hand_total: hands.length,
    hand_crisis_match: hands.filter((c) => need.includes(kindOf(c))).length,
    hand_nonstart: hands.filter((c) => g.cards[c].o !== 'start').length,
    equipped: equip.length,
    equipped_weapons: equip.filter((c) => kindOf(c) === 'weapon').length,
    waste: g.waste.length,
    waste_next_penalty_in: (g.wastePer || 10) - (g.waste.length % (g.wastePer || 10)),
    decks_remaining: decks.reduce((a, b) => a + b, 0),
    decks_empty: decks.filter((n) => n === 0).length,
    obj_hard: g.settings.side === 'hard' ? 1 : 0,
    obj_progress: ctx.objectiveProgress(g),
    under_objective: g.underObjective.length,
    samples: g.samples,
  };
  for (const k of KINDS) f['hand_' + k] = hands.filter((c) => kindOf(c) === k).length;
  for (const k of NEED_KINDS) f['crisis_need_' + k] = need.includes(k) ? 1 : 0;
  for (const o of OBJECTIVES) f['obj_' + o] = g.settings.objective === o ? 1 : 0;
  return FEATURE_NAMES.map((n) => +f[n].toFixed(4));
}

module.exports = { SCHEMA_VERSION, FEATURE_NAMES, extract };
