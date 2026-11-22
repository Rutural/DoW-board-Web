'use strict';
/* 데드 오브 윈터 2인 협력 보드 도우미 · 클라이언트 */

const socket = io({ transports: ['websocket', 'polling'] });
let DATA = null, SURV = {}, TPL = {}, CRISIS = {}, XR = {}, OBJ = {}, LOC = {}, KINDS = {};
let R = null; // 서버가 보낸 방 상태
let modal = null; // { kind, ...args }
let ui = { setupPick: [], setupLeader: null, searchSel: [], logOpen: true };

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const J = (o) => esc(JSON.stringify(o));
const me = () => R && R.seat;
const G = () => R && R.game;
const pname = (i) => (R && R.seats[i] ? R.seats[i].name : `P${i + 1}`);

const SAVE_KEY = 'dow-session';
const saveSession = (s) => localStorage.setItem(SAVE_KEY, JSON.stringify(s));
const loadSession = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } };

fetch('/data.json').then((r) => r.json()).then((d) => {
  DATA = d;
  SURV = Object.fromEntries(d.survivors.map((s) => [s.id, s]));
  TPL = d.items.templates;
  CRISIS = Object.fromEntries(d.game.crises.map((c) => [c.id, c]));
  XR = Object.fromEntries(d.crossroads.map((c) => [c.id, c]));
  OBJ = Object.fromEntries(d.game.objectives.map((o) => [o.id, o]));
  LOC = Object.fromEntries(d.game.locations.map((l) => [l.id, l]));
  KINDS = d.game.kinds;
  render();
});

// ─────────── 소켓 ───────────
socket.on('connect', () => {
  const s = loadSession();
  if (s && s.code && s.token) socket.emit('room.resume', s);
});
socket.on('joined', ({ code, token }) => { saveSession({ code, token }); history.replaceState(null, '', '/?room=' + code); });
socket.on('resume.fail', () => { localStorage.removeItem(SAVE_KEY); render(); });
socket.on('state', (room) => { R = room; render(); });
socket.on('toast', ({ text, error }) => toast(text, error));
socket.on('disconnect', () => toast('서버와 연결이 끊겼습니다. 다시 연결 중…', true));

function act(type, payload) { socket.emit('act', { type, payload }); }
function toast(text, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 4200 : 2600);
}

// ─────────── 이벤트 위임 ───────────
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a],[data-ui]');
  if (!t) {
    if (e.target.classList.contains('modal-bg')) closeModal();
    return;
  }
  if (t.dataset.a) {
    const p = t.dataset.p ? JSON.parse(t.dataset.p) : {};
    if (t.dataset.confirm && !confirm(t.dataset.confirm)) return;
    act(t.dataset.a, p);
    if (t.dataset.close) closeModal();
    return;
  }
  const p = t.dataset.p ? JSON.parse(t.dataset.p) : {};
  UI[t.dataset.ui] && UI[t.dataset.ui](p, t, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function openModal(m) { modal = m; renderModal(); }
function closeModal() { modal = null; renderModal(); }

const UI = {
  create() {
    const name = document.getElementById('nm').value;
    socket.emit('room.create', { name, settings: readSettings() });
  },
  join() {
    const name = document.getElementById('nm').value;
    const code = document.getElementById('code').value;
    socket.emit('room.join', { name, code });
  },
  leave() { if (!confirm('이 방에서 나갈까요? (나중에 같은 기기에서는 다시 들어올 수 있습니다)')) return; socket.emit('room.leave'); R = null; history.replaceState(null, '', '/'); render(); },
  forget() { localStorage.removeItem(SAVE_KEY); socket.emit('room.leave'); R = null; history.replaceState(null, '', '/'); render(); },
  settings() { socket.emit('room.settings', readSettings()); },
  start() { socket.emit('game.start'); },
  abandon() { if (confirm('진행 중인 게임을 버리고 대기실로 돌아갈까요?')) socket.emit('game.abandon'); },
  copyLink() { navigator.clipboard.writeText(location.origin + '/?room=' + R.code).then(() => toast('초대 링크를 복사했습니다.')); },
  undo() { socket.emit('undo'); },
  rules() { openModal({ kind: 'rules' }); },
  objective() { openModal({ kind: 'objective' }); },
  surv({ id }) { openModal({ kind: 'surv', id }); },
  card({ id }) { openModal({ kind: 'card', id }); },
  equipCard({ id, survivor }) { openModal({ kind: 'equip', id, survivor }); },
  close() { closeModal(); },
  xr() { openModal({ kind: 'xr' }); },
  search() { ui.searchSel = []; openModal({ kind: 'search' }); },
  searchSel({ id }) {
    const k = ui.searchSel.indexOf(id);
    if (k >= 0) ui.searchSel.splice(k, 1); else ui.searchSel.push(id);
    renderModal();
  },
  searchTake() { if (!ui.searchSel.length) return toast('가져갈 카드를 1장 이상 고르세요.', true); act('search.take', { ids: ui.searchSel }); ui.searchSel = []; closeModal(); },
  die({ i }) { openModal({ kind: 'die', i }); },
  loc({ id }) { openModal({ kind: 'loc', id }); },
  pick({ id }) {
    const k = ui.setupPick.indexOf(id);
    if (k >= 0) { ui.setupPick.splice(k, 1); if (ui.setupLeader === id) ui.setupLeader = null; }
    else if (ui.setupPick.length < 3) ui.setupPick.push(id);
    else return toast('3명까지만 고를 수 있습니다.', true);
    render();
  },
  leader({ id }, el, e) { e.stopPropagation(); if (!ui.setupPick.includes(id)) ui.setupPick.push(id); ui.setupLeader = id; render(); },
  confirmPick() {
    if (ui.setupPick.length !== 3) return toast('3명을 고르세요.', true);
    if (!ui.setupLeader) return toast('리더를 정하세요(★).', true);
    act('setup.pick', { picked: ui.setupPick, leader: ui.setupLeader });
  },
  moveSurv({ id }) {
    const to = document.getElementById('mv-to').value;
    const exposure = document.querySelector('input[name=mv-exp]:checked')?.value || 'roll';
    if (exposure === 'fuel') {
      const fid = document.getElementById('mv-fuel')?.value;
      if (!fid) return toast('사용할 연료 카드가 없습니다.', true);
      act('card.waste', { id: fid });
    }
    act('surv.move', { id, to, exposure });
    closeModal();
  },
  killZ({ id }) {
    const s = G().survivors[id];
    const n = +document.getElementById('kz-n').value || 1;
    const exposure = document.getElementById('kz-exp').checked;
    act('zombie.kill', { loc: s.loc, survivor: id, n, exposure });
    closeModal();
  },
  note({ id }) { const v = document.getElementById('note-t').value.trim(); if (v) act('surv.note', { id, text: v }); },
  effect() { const t = prompt('진행 중 효과를 적어 두세요 (예: 눈보라 — 다음 라운드 끝까지 이동 불가)'); if (t) act('effect.add', { text: t }); },
  chat(p, el, e) { const i = document.getElementById('chat'); if (i.value.trim()) { act('chat', { text: i.value.trim() }); i.value = ''; } },
  equipTo({ id }) { const t = document.getElementById('eq-to').value; if (!t) return toast('장착할 생존자를 고르세요.', true); act('card.play', { id, target: t }); closeModal(); },
  transfer({ id, from }) { const t = document.getElementById('tr-to').value; if (!t) return toast('받을 생존자를 고르세요.', true); act('card.transfer', { id, from, to: t }); closeModal(); },
  fetchCard() {
    const src = document.getElementById('fc-src').value;
    const id = document.getElementById('fc-card').value;
    if (!id) return toast('카드를 고르세요.', true);
    if (src === 'waste' || src === 'removed') act('deck.fetch', { source: src, id });
    else act('deck.fetch', { loc: src, id });
    closeModal();
  },
  fetchOpen() { openModal({ kind: 'fetch', src: 'waste' }); },
  fetchSrc() { modal.src = document.getElementById('fc-src').value; renderModal(); },
  recruit() { openModal({ kind: 'recruit' }); },
  recruitGo() {
    const id = document.getElementById('rc-id').value || undefined;
    const to = document.getElementById('rc-to').value;
    act('surv.recruit', { id, to }); closeModal();
  },
  lure() { openModal({ kind: 'lure' }); },
  lureGo() { act('zombie.lure', { from: document.getElementById('lu-from').value, to: document.getElementById('lu-to').value }); closeModal(); },
  logToggle() { ui.logOpen = !ui.logOpen; render(); },
};

function readSettings() {
  return {
    objective: document.getElementById('s-obj')?.value,
    side: document.getElementById('s-side')?.value,
    adult: document.getElementById('s-adult')?.checked,
  };
}

// ─────────── 렌더 ───────────
function render() {
  if (!DATA) { $app.innerHTML = '<div class="lobby muted">불러오는 중…</div>'; return; }
  if (!R) return renderLobby();
  const g = G();
  if (!g) return renderWaiting();
  if (g.phase === 'setup') return renderSetup();
  renderGame();
  renderModal();
}

function objBlock(objId, side) {
  const o = OBJ[objId]; const s = o.sides[side];
  return `<div class="obj-desc">
    <b>${esc(s.title || o.name)}</b> <span class="tag">${side === 'hard' ? '하드코어면' : '일반면'}</span> <span class="tag">${esc(s.time)}</span>
    <div class="stats"><span>사기 ${s.morale}</span><span>라운드 ${s.rounds}</span></div>
    <div class="small muted">준비: 피난기지 좀비 ${s.colonyZ}${s.otherZ ? ` · 다른 장소마다 좀비 ${s.otherZ}` : ''}${(s.helplessPerPlayer || s.helplessFlat) ? ` · 노약자 ${s.helplessPerPlayer * 2 + (s.helplessFlat || 0)}` : ''}</div>
    <div style="margin-top:6px">${esc(s.victory)}</div>
  </div>`;
}

function settingsForm(st, disabled) {
  const d = disabled ? 'disabled' : '';
  return `
  <div class="field"><label>공동목표</label>
    <select id="s-obj" ${d} data-ui-change="settings">${DATA.game.objectives.map((o) => `<option value="${o.id}" ${st.objective === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>
  <div class="row">
    <div class="field grow"><label>면</label>
      <select id="s-side" ${d}><option value="hard" ${st.side === 'hard' ? 'selected' : ''}>하드코어면 (2인 공식)</option><option value="normal" ${st.side === 'normal' ? 'selected' : ''}>일반면 (연습용)</option></select></div>
    <div class="field"><label>&nbsp;</label><label class="row" style="color:var(--ink);font-size:13px"><input type="checkbox" id="s-adult" ${st.adult ? 'checked' : ''} ${d}> 성인 테마 크로스로드 포함</label></div>
  </div>
  ${objBlock(st.objective, st.side)}`;
}

function renderLobby() {
  const params = new URLSearchParams(location.search);
  const code = params.get('room') || '';
  const sess = loadSession();
  $app.innerHTML = `
  <div class="lobby">
    <div class="brand"><h1>겨울의 생존자들</h1><div class="sub">데드 오브 윈터 본판 · 2인 협력 보드 도우미</div></div>
    <div class="field" style="max-width:320px"><label>내 이름</label><input id="nm" maxlength="16" placeholder="예: 민지" value="${esc(localStorage.getItem('dow-name') || '')}"></div>
    <div class="lobby-grid">
      <div class="card">
        <h2>방 만들기</h2>
        ${settingsForm({ objective: 'samples', side: 'hard', adult: false }, false)}
        <div style="margin-top:12px"><button class="pri" data-ui="create">방 만들기</button></div>
      </div>
      <div class="card">
        <h2>방 참가</h2>
        <div class="field"><label>방 코드 (4글자)</label><input id="code" maxlength="4" style="text-transform:uppercase;font-size:22px;letter-spacing:.2em;width:160px" value="${esc(code)}"></div>
        <button class="pri" data-ui="join">참가하기</button>
        ${sess ? `<p class="small muted" style="margin-top:16px">이전에 들어갔던 방(${esc(sess.code)})이 있으면 자동으로 다시 연결됩니다. <button class="sm ghost" data-ui="forget">기록 지우기</button></p>` : ''}
        <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
        <p class="small muted">2인 공식 변형 규칙: 공동목표 하드코어면 · 비밀목표 없음 · 시작 아이템 7장 · 생존자 4명 중 3명 선택 · 비협력 카드 제외. 판정은 플레이어가 직접 하고, 이 도구는 상태 관리·덱·계산을 맡습니다.</p>
      </div>
    </div>
  </div>`;
  const nm = document.getElementById('nm');
  nm.addEventListener('input', () => localStorage.setItem('dow-name', nm.value));
  const upd = () => { const st = readSettings(); document.querySelector('.obj-desc').outerHTML = objBlock(st.objective, st.side); };
  document.getElementById('s-obj').addEventListener('change', upd);
  document.getElementById('s-side').addEventListener('change', upd);
}

function renderWaiting() {
  const st = R.settings;
  const full = R.seats.every(Boolean);
  $app.innerHTML = `
  <div class="lobby">
    <div class="brand"><h1>대기실</h1><div class="sub">친구에게 코드나 링크를 보내 주세요</div></div>
    <div class="lobby-grid">
      <div class="card">
        <h2>방 코드</h2>
        <div class="code-big">${esc(R.code)}</div>
        <div class="row" style="justify-content:center"><button data-ui="copyLink">초대 링크 복사</button><button class="ghost" data-ui="leave">나가기</button></div>
        <div class="seat-list">${[0, 1].map((i) => `<div class="seat ${R.seats[i] ? 'filled' : ''}">
          <div class="small muted">P${i + 1}${i === me() ? ' (나)' : ''}</div>
          <div style="font-weight:700;font-size:16px">${R.seats[i] ? `<span class="dot ${R.seats[i].online ? 'on' : ''}"></span> ${esc(R.seats[i].name)}` : '<span class="faint">기다리는 중…</span>'}</div></div>`).join('')}</div>
      </div>
      <div class="card">
        <h2>게임 설정</h2>
        ${settingsForm(st, false)}
        <div class="row" style="margin-top:12px"><button class="pri" data-ui="start" ${full ? '' : 'disabled'}>게임 시작</button>${full ? '' : '<span class="small muted">두 명이 모두 들어오면 시작할 수 있어요</span>'}</div>
      </div>
    </div>
  </div>`;
  for (const id of ['s-obj', 's-side', 's-adult']) document.getElementById(id).addEventListener('change', UI.settings);
}

function renderSetup() {
  const g = G(); const p = g.players[me()];
  const other = g.players[1 - me()];
  if (p.ready) {
    $app.innerHTML = `<div class="lobby"><div class="brand"><h1>준비 완료</h1><div class="sub">${esc(pname(1 - me()))}님이 생존자를 고르는 중입니다…</div></div>
      <div class="card">${objBlock(g.settings.objective, g.settings.side)}<div style="margin-top:12px"><button data-a="setup.unready">다시 고르기</button></div></div></div>`;
    return;
  }
  const hand = p.hand || [];
  $app.innerHTML = `
  <div class="lobby" style="max-width:1100px">
    <div class="brand"><h1>생존자 선택</h1><div class="sub">4명 중 3명을 고르고 ★로 리더를 정하세요 ${other.ready ? '· 상대는 준비 완료' : ''}</div></div>
    <div class="pick-grid">${p.dealtSurvivors.map((id) => survCard(id, { ui: 'pick', sel: ui.setupPick.includes(id), leaderBtn: true, isLeader: ui.setupLeader === id })).join('')}</div>
    <div class="row" style="margin:16px 0"><button class="pri" data-ui="confirmPick">선택 완료 (${ui.setupPick.length}/3${ui.setupLeader ? ', 리더 ' + esc(SURV[ui.setupLeader].name) : ''})</button></div>
    <div class="lobby-grid">
      <div class="card"><h2>공동목표</h2>${objBlock(g.settings.objective, g.settings.side)}</div>
      <div class="card"><h2>내 시작 아이템 (${hand.length}장)</h2><div class="hand">${hand.map((c) => icard(c, g)).join('')}</div></div>
    </div>
  </div>`;
}

function survsAt(g, loc) { return Object.keys(g.survivors).filter((id) => g.survivors[id].loc === loc).sort((a, b) => SURV[b].inf - SURV[a].inf); }


UI.addZ = ({ loc }) => { const n = parseInt(prompt(`${LOC[loc].name}에 추가할 좀비 수 (입구 순서대로 배치, 바리케이드 파괴·침입 자동 계산)`, '1'), 10); if (n > 0) act('zombie', { loc, d: n }); };


function predHtml(g) {
  if (!g.pred || ui.hidePred) return g.pred ? '<div class="pred-row"><button class="sm ghost" data-ui="togglePred">AI 예측 보기</button></div>' : '';
  const gauge = (label, p, good) => {
    const pct = Math.round(p.p * 100);
    const tone = good ? (pct >= 70 ? 'ok' : pct >= 40 ? 'mid' : 'bad') : (pct >= 50 ? 'bad' : pct >= 25 ? 'mid' : 'ok');
    return `<div class="gauge ${tone}" title="모델 ${esc(p.version)}"><span class="g-lab">${label}</span><span class="g-bar"><i style="width:${pct}%"></i></span><b>${pct}%</b></div>`;
  };
  return `<div class="pred"><div class="pred-head"><span class="tiny muted">AI 예측 · 라운드 ${g.pred.round} 시작 시점</span><span class="spacer"></span><button class="sm ghost" data-ui="togglePred">숨기기</button></div>
    ${g.pred.y_crisis ? gauge('이번 위기 성공 가능성', g.pred.y_crisis, true) : ''}${g.pred.y_collapse ? gauge('이번 라운드 붕괴 위험', g.pred.y_collapse, false) : ''}</div>`;
}
UI.togglePred = () => { ui.hidePred = !ui.hidePred; render(); };

function renderPhase(g) {
  const my = me();
  if (g.phase === 'ended') {
    return `<div class="panel end-screen"><h2>${g.end.win ? '🏆 생존 성공' : '❄ 겨울에 졌습니다'}</h2><p class="muted">${esc(g.end.why)}</p>
      <div class="row" style="justify-content:center"><button class="pri" data-ui="abandon">대기실로 (새 게임)</button></div></div>`;
  }
  if (g.stage === 'player') {
    const mine = g.turn === my;
    return `<div class="panel"><header><h3>라운드 ${g.round} · ${mine ? '내 턴' : esc(pname(g.turn)) + '의 턴'}</h3><span class="spacer"></span>
      ${mine ? '<button class="pri" data-a="turn.end" data-confirm="턴을 마칠까요? 발동하지 않은 크로스로드는 덱 아래로 갑니다.">턴 종료</button>' : ''}</header>
      ${predHtml(g)}
      <div class="small muted">${mine ? '원하는 행동을 원하는 순서로 하세요. 생존자를 누르면 이동·공격·탐색 등을 할 수 있어요.' : '상대의 턴입니다. 크로스로드 조건이 맞으면 발동시키세요.'}</div>
      ${g.effects.length ? `<div style="margin-top:8px">${g.effects.map((t, i) => `<div class="row small"><span class="pill warn">진행 중</span><span class="grow">${esc(t)}</span><button class="sm ghost" data-a="effect.remove" data-p='${J({ i })}'>✕</button></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="sm" data-ui="effect">+ 진행 중 효과 메모</button><button class="sm" data-a="roll.d6">🎲 주사위 1개 굴리기</button><button class="sm" data-ui="fetchOpen">덱·더미에서 카드 찾기</button></div>
    </div>`;
  }
  // 피난기지 단계
  const st = g.colonySteps || {};
  const side = OBJ[g.settings.objective].sides[g.settings.side];
  const step = (n, done, text, btn) => `<div class="step ${done ? 'done' : ''}"><span class="n">${done ? '✓' : n}</span><span class="t">${text}</span>${btn}</div>`;
  const outside = DATA.game.locations.filter((l) => l.id !== 'colony');
  const zText = `피난기지 ${g.calc.colonyZombiesNext}마리` + outside.map((l) => { const n = survsAt(g, l.id).length; return n ? ` · ${l.name} ${n}` : ''; }).join('') + (outside.some((l) => g.locs[l.id].noise) ? ' · 소음 굴림' : '');
  return `<div class="panel"><header><h3>피난기지 단계 · 라운드 ${g.round}</h3></header>
    ${g.settings.objective === 'winter' ? `<div class="banner gold small">겨울이 왔다: 이 단계 시작 시 연료 카드 1장을 목표 아래에 놓아야 합니다 (현재 ${g.underObjective.length}장). 손패의 연료 카드 → "공동목표 아래에 놓기". 놓지 못하면 게임 종료.</div>` : ''}
    <div class="steps">
      ${step(1, st.food, `식량 지불: 필요 <b>${g.calc.foodNeeded}</b> / 보유 <b>${g.food}</b>${!st.food && g.food < g.calc.foodNeeded ? ` <span style="color:var(--blood)">→ 부족 (굶주림 ${g.starvation + 1}개, 사기 −${g.starvation + 1})</span>` : ''}`, `<button class="sm" data-a="colony.food" ${st.food ? 'disabled' : ''}>적용</button>`)}
      ${step(2, st.waste, `쓰레기 확인: ${g.waste.length}장 → 사기 −${g.calc.wasteLoss}`, `<button class="sm" data-a="colony.waste" ${st.waste ? 'disabled' : ''}>적용</button>`)}
      ${step(3, st.crisis, g.crisis ? `위기 해결: 「${esc(CRISIS[g.crisis.id].name)}」 기여 ${g.crisis.count}장 / 필요 2점` : '위기 해결 완료', `<button class="sm" data-a="crisis.resolve" ${g.crisis ? '' : 'disabled'}>공개</button>`)}
      ${step(4, st.zombies, `좀비 추가: ${zText}`, `<button class="sm" data-a="colony.zombies" ${st.zombies ? 'disabled' : ''}>배치</button>`)}
      ${step(5, st.objective, `공동목표 확인: ${esc(side.victory)}<br><span class="tiny" style="color:${g.objectiveAuto.done ? '#7fe0a0' : '#c9d3df'}">자동 판정(참고): ${g.objectiveAuto.done ? '달성' : '미달성'} · 진행 ${Math.round(g.objectiveAuto.progress * 100)}%${g.objectiveAuto.failed ? ' · ⚠ 실패 조건' : ''}</span>`, `<div class="col" style="gap:3px"><button class="sm pri" data-a="colony.objective" data-p='${J({ done: true })}' data-confirm="공동목표를 달성했나요? 게임이 승리로 끝납니다.">달성</button><button class="sm" data-a="colony.objective" data-p='${J({ done: false })}'>아직</button></div>`)}
      ${step(6, false, `라운드 마커 −1 (→ ${g.round - 1}), 시작 플레이어를 ${esc(pname(1 - g.startPlayer))}에게`, `<button class="sm pri" data-a="colony.next" ${st.objective ? '' : 'data-confirm="공동목표 확인을 하지 않았습니다. 그래도 다음 라운드로 갈까요?"'}>다음 라운드</button>`)}
    </div>
    ${g.crisisResolved ? crisisResultHtml(g) : ''}
  </div>`;
}

function crisisResultHtml(g) {
  const c = g.crisisResolved;
  const res = { fail: ['red', '✖ 실패 — 실패 효과를 보드에 적용하세요'], pass: ['blue', '✔ 막았습니다'], bonus: ['gold', '✔ 막고 사기 +1 (자동 적용됨)'] }[c.result];
  return `<div class="banner ${res[0]}" style="margin-top:10px;flex-direction:column;align-items:flex-start">
    <b>${esc(CRISIS[c.id].name)} · 점수 ${c.score} / 필요 ${c.need}</b>
    <div class="row">${c.cards.map((x) => `<span class="pill ${x.ok ? 'on' : 'warn'}">${esc(TPL[g.cards[x.id].t].name)} ${x.ok ? '+1' : '−1'}</span>`).join('') || '<span class="small">기여한 카드 없음</span>'}</div>
    <div class="small">${res[1]}</div>
    ${c.result === 'fail' ? `<div class="small" style="color:#ffcfc9">실패 효과: ${esc(CRISIS[c.id].fail)}</div>
      ${c.applied ? '<div class="small">✔ 자동 적용함</div>' : '<button class="sm warn" data-a="crisis.autoFail">실패 효과 자동 적용</button>'}` : ''}</div>`;
}


function logHtml(g) {
  const items = g.log.slice(-160).reverse().map((l) => {
    const cls = l.text.startsWith('━━') || l.text.startsWith('▶') || l.text.startsWith('■') ? 'hd' : /✖|✝|⚠|부족/.test(l.text) ? 'bad' : l.text.startsWith('💬') ? 'chat' : '';
    return `<div class="${cls}">${esc(l.text)}</div>`;
  }).join('');
  return `<div class="panel"><header><h3>기록</h3><span class="spacer"></span><button class="sm ghost" data-ui="logToggle">${ui.logOpen ? '접기' : '펼치기'}</button></header>
    <div class="row" style="margin-bottom:6px"><input id="chat" class="grow" placeholder="메시지 (Enter)" maxlength="200"><button class="sm" data-ui="chat">보내기</button></div>
    ${ui.logOpen ? `<div class="log">${items}</div>` : ''}</div>`;
}

function bannersHtml(g) {
  let h = '';
  if (g.pendingOverrun) {
    const o = g.pendingOverrun;
    h += `<div class="banner red"><b>⚠ ${esc(LOC[o.loc].name)} 침입 ${o.count}회</b><span class="small">${o.victims && o.victims.length ? '사망: ' + o.victims.map(esc).join(', ') + ' (영향력 최저 순, 자동 처리)' : '생존자가 없어 효과 없음'}</span>
      <button class="sm" data-a="overrun.clear">확인</button></div>`;
  }
  if (g.pendingBite) {
    const b = g.pendingBite;
    h += `<div class="banner red"><b>⚠ 물림 확산 → ${esc(SURV[b.target].name)}</b><span class="small">(${esc(pname(g.survivors[b.target]?.owner ?? 0))} 선택)</span>
      <button class="sm warn" data-a="bite.resolve" data-p='${J({ choice: 'die' })}'>죽인다 (확산 멈춤)</button>
      <button class="sm" data-a="bite.resolve" data-p='${J({ choice: 'roll' })}'>위험노출 재굴림 (빈칸만 생존)</button></div>`;
  }
  const p = g.players[me()];
  if (p.needLeader) h += `<div class="banner gold">리더를 잃었습니다. 내 생존자를 눌러 "리더로 지정"을 선택하세요.</div>`;
  if (g.xr && g.xr.revealed) h += `<div class="banner gold">⚡ 크로스로드 「${esc(XR[g.xr.id].name)}」 발동 중 <button class="sm pri" data-ui="xr">카드 보기</button></div>`;
  return h;
}


// ─────────── 모달 ───────────
function renderModal() {
  if (!modal || !G()) { $modal.innerHTML = ''; return; }
  const g = G();
  const fn = M[modal.kind];
  const html = fn ? fn(g, modal) : null;
  if (html == null) { modal = null; $modal.innerHTML = ''; return; }
  const keep = {}; $modal.querySelectorAll('input,select,textarea').forEach((el) => { if (el.id) keep[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value; });
  $modal.innerHTML = `<div class="modal-bg"><div class="modal ${modal.wide ? 'wide' : ''}"><button class="close icon ghost" data-ui="close">✕</button>${html}</div></div>`;
  $modal.querySelectorAll('input,select,textarea').forEach((el) => { if (el.id && el.id in keep && el.type !== 'radio') { if (el.type === 'checkbox') el.checked = keep[el.id]; else el.value = keep[el.id]; } });
  if (modal.kind === 'fetch') document.getElementById('fc-src').addEventListener('change', UI.fetchSrc);
}

const locOptions = (g, except) => DATA.game.locations.filter((l) => l.id !== except).map((l) => {
  const occ = Object.values(g.survivors).filter((s) => s.loc === l.id).length + (l.id === 'colony' ? g.helpless : 0);
  return `<option value="${l.id}" ${occ >= l.slots ? 'disabled' : ''}>${esc(l.name)} (${occ}/${l.slots})</option>`;
}).join('');

const M = {};
M.surv = (g, { id }) => {
  const s = g.survivors[id]; if (!s) return null;
  const sv = SURV[id]; const mine = s.owner === me();
  const fuel = (g.players[me()].hand || []).filter((c) => g.cards[c].t === 'fuel');
  const z = s.loc === 'colony' ? g.locs.colony.entrances.reduce((a, e) => a + e.z, 0) : g.locs[s.loc].z;
  const same = Object.keys(g.survivors).filter((o) => o !== id && g.survivors[o].loc === s.loc);
  return `<h2>${s.leader ? '★ ' : ''}${esc(sv.name)}</h2>
    <div class="small muted">${esc(sv.job)} · ${esc(pname(s.owner))} · 현재 ${esc(LOC[s.loc].name)}${s.moved ? ' · 이번 턴 이동함' : ''}</div>
    <div class="row" style="margin-top:8px"><span class="stat"><b>${sv.inf}</b><span>영향력</span></span><span class="stat"><b>${sv.atk}+</b><span>공격</span></span><span class="stat"><b>${sv.srch}+</b><span>탐색</span></span>
      <span class="stat"><b style="color:var(--blood)">${s.wounds}</b><span>부상</span></span><span class="stat"><b style="color:var(--frost)">${s.frost}</b><span>동상</span></span><span class="stat"><b>${sv.maxWounds || 3}</b><span>사망</span></span></div>
    <section><h4>능력</h4><div class="ability"><div class="where">${esc(sv.place)}${sv.cost ? ` · 주사위 ${esc(sv.cost)}` : ''}${sv.once ? ' · 라운드당 1회' : ''}</div>${esc(sv.ability)}</div>
      ${sv.once || sv.cost ? `<button class="sm" style="margin-top:6px" data-a="surv.used" data-p='${J({ id })}'>${s.used ? '사용 표시 해제' : '능력 사용 표시'}</button>` : ''}</section>
    <section><h4>이동 (생존자마다 턴당 1회)</h4>
      <div class="row"><select id="mv-to">${locOptions(g, s.loc)}</select>
        <label class="row" style="color:var(--ink)"><input type="radio" name="mv-exp" value="roll" checked>위험노출 굴림</label>
        <label class="row" style="color:var(--ink)"><input type="radio" name="mv-exp" value="fuel" ${fuel.length ? '' : 'disabled'}>연료 사용${fuel.length ? '' : ' (없음)'}</label>
        <label class="row" style="color:var(--ink)"><input type="radio" name="mv-exp" value="none">굴림 없음</label>
        ${fuel.length ? `<input type="hidden" id="mv-fuel" value="${fuel[0]}">` : ''}
        <button class="pri sm" data-ui="moveSurv" data-p='${J({ id })}'>이동</button></div></section>
    <section><h4>행동</h4>
      <div class="row">
        <span class="small muted">공격·처치:</span><input id="kz-n" type="number" min="1" max="8" value="1" style="width:56px"><span class="small">마리</span>
        <label class="row" style="color:var(--ink)"><input type="checkbox" id="kz-exp" checked>위험노출 굴림</label>
        <button class="sm" data-ui="killZ" data-p='${J({ id })}' ${z ? '' : 'disabled'}>좀비 처치 (${z})</button></div>
      <div class="row" style="margin-top:6px">
        ${s.loc !== 'colony' ? `<button class="sm" data-a="search.start" data-p='${J({ loc: s.loc, survivor: id })}' data-close="1" ${mine ? '' : 'disabled'}>탐색 (${sv.srch}+)</button>` : ''}
        <button class="sm" data-a="barricade" data-p='${J({ loc: s.loc, d: 1 })}'>바리케이드</button>
        <button class="sm" data-a="surv.exposure" data-p='${J({ id })}'>위험노출 굴림</button>
        <span class="small muted">주사위는 직접 사용 표시하세요</span></div></section>
    <section><h4>부상</h4><div class="row">
      <button class="sm" data-a="surv.wound" data-p='${J({ id, kind: 'wound', d: 1 })}'>부상 +1</button><button class="sm" data-a="surv.wound" data-p='${J({ id, kind: 'wound', d: -1 })}'>부상 −1</button>
      <button class="sm" data-a="surv.wound" data-p='${J({ id, kind: 'frost', d: 1 })}'>동상 +1</button><button class="sm" data-a="surv.wound" data-p='${J({ id, kind: 'frost', d: -1 })}'>동상 −1</button></div></section>
    <section><h4>장착 (${s.equip.length})</h4>
      ${s.equip.map((c) => { const t = TPL[g.cards[c].t]; const u = (s.equipUsed || []).includes(c); return `<div class="row" style="margin-bottom:4px"><span class="pill k-${t.kind}" style="color:var(--k);border-color:var(--k)">${esc(t.name)}</span><span class="small grow muted">${esc(t.text)}</span>
        ${t.once ? `<button class="sm" data-a="card.equipUsed" data-p='${J({ id: c, survivor: id })}'>${u ? '사용함 ✓' : '사용'}</button>` : ''}<button class="sm" data-ui="equipCard" data-p='${J({ id: c, survivor: id })}'>…</button></div>`; }).join('') || '<span class="faint small">없음</span>'}</section>
    ${s.notes.length || true ? `<section><h4>부착 카드·메모</h4>${s.notes.map((n, i) => `<div class="row small"><span class="grow">📎 ${esc(n)}</span><button class="sm ghost" data-a="surv.note" data-p='${J({ id, remove: i })}'>✕</button></div>`).join('')}
      <div class="row"><input id="note-t" class="grow" placeholder="예: 말 — 이동 시 굴림 없음, 식량 +1 지불"><button class="sm" data-ui="note" data-p='${J({ id })}'>추가</button></div></section>` : ''}
    <section><h4>기타</h4><div class="row">
      <button class="sm" data-a="surv.leader" data-p='${J({ id })}'>리더로 지정</button>
      <button class="sm" data-a="surv.give" data-p='${J({ id })}' data-confirm="이 생존자를 상대에게 넘길까요?">상대에게 넘기기</button>
      <button class="sm" data-a="surv.removeFromGame" data-p='${J({ id })}' data-close="1" data-confirm="게임에서 제거할까요? (사망이 아니므로 사기는 그대로)">게임에서 제거</button>
      <button class="sm warn" data-a="surv.kill" data-p='${J({ id })}' data-close="1" data-confirm="${esc(sv.name)}을(를) 죽일까요? 사기 −1">사망 처리</button></div></section>`;
};

M.equip = (g, { id, survivor }) => {
  const s = g.survivors[survivor]; if (!s || !s.equip.includes(id)) return null;
  const t = TPL[g.cards[id].t];
  const same = Object.keys(g.survivors).filter((o) => o !== survivor && g.survivors[o].loc === s.loc);
  return `<h2>${esc(t.name)}</h2><div class="small muted">${esc(SURV[survivor].name)}에게 장착됨</div>
    <div class="ability" style="margin-top:8px">${esc(t.text)}</div>
    <section><h4>긴급 전달 (같은 장소의 생존자)</h4><div class="row"><select id="tr-to"><option value="">받을 생존자</option>${same.map((o) => `<option value="${o}">${esc(SURV[o].name)} (${esc(pname(g.survivors[o].owner))})</option>`).join('')}</select><button class="sm" data-ui="transfer" data-p='${J({ id, from: survivor })}'>전달</button></div></section>
    <section><h4>장착 해제·처리</h4><div class="row">
      <button class="sm" data-a="card.contribute" data-p='${J({ id, from: survivor })}' data-close="1">위기에 기여</button>
      <button class="sm" data-a="card.unequip" data-p='${J({ id, survivor, to: 'waste' })}' data-close="1">쓰레기장 (탄약 없음 등)</button>
      <button class="sm" data-a="card.unequip" data-p='${J({ id, survivor, to: 'hand' })}' data-close="1">손으로 (사망 처리 등)</button>
      <button class="sm" data-a="card.unequip" data-p='${J({ id, survivor, to: 'removed' })}' data-close="1">게임에서 제거</button></div></section>`;
};

M.card = (g, { id }) => {
  const mine = (g.players[me()].hand || []).includes(id);
  if (!mine) {
    if (!g.cards[id]) return null;
    const t = TPL[g.cards[id].t];
    return `<h2>${esc(t.name)}</h2><div class="ability" style="margin-top:8px">${esc(t.text)}</div>`;
  }
  const t = TPL[g.cards[id].t]; const o = g.cards[id].o;
  const my = Object.keys(g.survivors).filter((s) => g.survivors[s].owner === me());
  const isMyTurn = g.stage === 'player' && g.turn === me();
  return `<h2>${esc(t.name)}</h2>
    <div class="row small"><span class="pill k-${t.kind}" style="color:var(--k);border-color:var(--k)">${esc(KINDS[t.kind])}</span><span class="pill">${t.use === 'equip' ? '장착' : t.use === 'event' ? '사건' : '쓰레기장'}</span><span class="pill">${o === 'start' ? '시작 아이템' : esc(LOC[o].name)}</span></div>
    <div class="ability" style="margin-top:10px">${esc(t.text)}</div>
    ${isMyTurn ? '' : '<div class="banner blue small" style="margin-top:10px">카드는 자기 턴에만 사용할 수 있습니다. (요청받아 건네는 것은 가능)</div>'}
    <section><h4>사용</h4><div class="row">
      ${t.use === 'equip' ? `<select id="eq-to"><option value="">장착할 내 생존자</option>${my.map((s) => `<option value="${s}">${esc(SURV[s].name)} (${esc(LOC[g.survivors[s].loc].name)})</option>`).join('')}</select><button class="pri sm" data-ui="equipTo" data-p='${J({ id })}'>장착</button>`
        : `<button class="pri sm" data-a="card.play" data-p='${J({ id })}' data-close="1">사용 → 쓰레기장${t.food ? ` (식량 +${t.food})` : t.addSurvivors ? ' (생존자 합류)' : ''}</button>`}
    </div><div class="small muted" style="margin-top:4px">${t.kind === 'medicine' && t.use === 'waste' && !g.cards[id].t.includes('adrenaline') ? '약: 사용 후 생존자 창에서 부상 −1을 눌러 주세요.' : t.kind === 'fuel' ? '연료: 생존자 이동 창에서 "연료 사용"을 고르면 자동으로 버려집니다.' : t.text.includes('주사위') ? '주사위 효과는 주사위를 눌러 직접 적용하세요.' : ''}</div></section>
    <section><h4>그 밖에</h4><div class="row">
      <button class="sm" data-a="card.contribute" data-p='${J({ id })}' data-close="1">위기에 기여 (뒷면)</button>
      <button class="sm" data-a="card.objective" data-p='${J({ id })}' data-close="1">공동목표 아래에 놓기</button>
      <button class="sm" data-a="card.give" data-p='${J({ id })}' data-close="1">${esc(pname(1 - me()))}에게 건네기</button>
      <button class="sm" data-a="card.waste" data-p='${J({ id })}' data-close="1">효과 없이 쓰레기장</button>
      <button class="sm warn" data-a="card.remove" data-p='${J({ id })}' data-close="1">게임에서 제거</button></div></section>`;
};

M.die = (g, { i }) => {
  const d = g.players[me()].dice[i]; if (!d) return null;
  return `<h2>주사위 ${d.v}</h2><div class="small muted">${d.used ? '사용함' : '미사용'}</div>
    <section><div class="row">
      <button class="pri" data-a="dice.use" data-p='${J({ i })}' data-close="1">${d.used ? '미사용으로 되돌리기' : '사용 표시'}</button>
      <button data-a="dice.food" data-p='${J({ i })}' ${d.used || d.v >= 6 || g.food <= 0 ? 'disabled' : ''}>식량 토큰으로 +1 (식량 ${g.food})</button>
      <button data-a="dice.reroll" data-p='${J({ i })}' ${d.used ? 'disabled' : ''}>다시 굴리기</button></div></section>
    <section><h4>눈 직접 설정 (능력·카드 효과용)</h4><div class="row">${[1, 2, 3, 4, 5, 6].map((v) => `<button class="die" style="width:34px;height:34px;font-size:16px" data-a="dice.set" data-p='${J({ i, v })}'>${v}</button>`).join('')}</div></section>`;
};

M.search = (g) => {
  const s = g.players[me()].search; if (!s) return null;
  const left = g.locs[s.loc].deckCount;
  return `<h2>${esc(LOC[s.loc].name)} 탐색</h2>
    <div class="small muted">본 카드 중 정확히 1장(능력·설계도로 추가 획득 시 그만큼)을 골라 가져가세요. 나머지는 덱 맨 아래로 갑니다.</div>
    <div class="hand" style="margin-top:10px">${s.cards.map((c) => { const t = TPL[g.cards[c].t]; return `<button class="icard k-${t.kind} ${ui.searchSel.includes(c) ? 'sel' : ''}" data-ui="searchSel" data-p='${J({ id: c })}'><span class="kind">${esc(KINDS[t.kind])}</span><span class="nm">${esc(t.name)}</span><span class="org">${esc(t.text.slice(0, 40))}…</span></button>`; }).join('')}</div>
    <section><div class="row">
      <button data-a="search.more" data-p='${J({ noise: true })}' ${g.locs[s.loc].noise >= LOC[s.loc].noise || !left ? 'disabled' : ''}>소음 토큰 놓고 1장 더 (소음 ${g.locs[s.loc].noise}/${LOC[s.loc].noise})</button>
      <button data-a="search.more" data-p='${J({ noise: false })}' ${left ? '' : 'disabled'}>능력·장비로 1장 더</button>
      <span class="small muted">남은 덱 ${left}장</span></div></section>
    <section><button class="pri" data-ui="searchTake">고른 ${ui.searchSel.length}장 가져가기</button></section>`;
};

M.xr = (g) => {
  const x = g.xr; if (!x || !x.id) return null;
  const c = XR[x.id]; const my = me();
  const canChoose = x.revealed;
  modal.wide = true;
  return `<div class="xr-card" style="border:none;background:none;padding:0">
    <div class="row"><h2 style="color:#e1d2ff">${esc(c.name)}</h2><span class="small faint">${esc(c.en)} · #${String(c.no).padStart(3, '0')}${c.group === 'survivor' ? ' 생존자 크로스로드' : ''}</span>${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">적용 대상: ${esc(pname(x.for))} · 읽는 사람: ${esc(pname(x.by))}</div>
    <div class="trig" style="margin-top:6px">발동 조건 — ${esc(c.trigger)}</div>
    <div class="story">${esc(c.story)}</div>
    ${c.mode === 'vote' ? `<div class="banner blue small">투표 카드: ${esc(c.voteRule)} 2인에서는 피난기지에 생존자가 있는 사람만 투표하고, 동점이면 시작 플레이어(${esc(pname(g.startPlayer))})가 결정합니다.</div>` : ''}
    ${c.options.map((o, i) => `<div class="opt ${x.chosen === i ? 'chosen' : ''}"><div class="row"><span class="lab">${esc(o.label)}</span><span class="spacer"></span>
      ${canChoose ? `<button class="sm ${x.chosen === i ? 'pri' : ''}" data-a="xr.choose" data-p='${J({ i })}'>${x.chosen === i ? '선택됨' : '이것으로'}</button>` : ''}</div>
      <div class="small" style="margin-top:4px">${esc(o.text)}</div><div class="eff">→ ${esc(o.effect)}</div></div>`).join('')}
    ${c.memo ? `<div class="small faint" style="margin-top:8px">메모: ${esc(c.memo)}</div>` : ''}
    <div class="row" style="margin-top:12px">
      ${!x.revealed && x.by === my ? `<button class="pri" data-a="xr.reveal">발동!</button><button class="ghost" data-a="xr.bottom" data-close="1" data-confirm="이 카드를 덱 맨 아래로 돌려놓을까요?">덱 아래로</button>` : ''}
      ${x.revealed ? `<button class="pri" data-a="xr.done" data-close="1" ${x.chosen == null ? 'data-confirm="선택지를 고르지 않았습니다. 그래도 처리 완료할까요?"' : ''}>효과 적용 완료 · 카드 제거</button><span class="small muted">효과는 보드에서 직접 적용하세요. 진행 중 효과는 메모로 남겨 두면 좋아요.</span>` : ''}
    </div></div>`;
};

M.objective = (g) => {
  const side = OBJ[g.settings.objective].sides[g.settings.side];
  const under = g.underObjective;
  return `<h2>공동목표</h2>${objBlock(g.settings.objective, g.settings.side)}
    <section><h4>목표 아래에 놓인 카드 (${under.length})</h4><div class="hand">${under.map((c) => { const t = TPL[g.cards[c].t]; return `<div class="icard k-${t.kind}"><span class="kind">${esc(KINDS[t.kind])}</span><span class="nm">${esc(t.name)}</span><span class="org">${g.cards[c].o === 'start' ? '⚠ 시작 아이템' : esc(LOC[g.cards[c].o]?.name)}</span></div>`; }).join('') || '<span class="faint small">없음</span>'}</div></section>
    <section><h4>상황</h4><div class="small">사기 ${g.morale} · 라운드 ${g.round} · 식량 ${g.food} · 다른 장소 좀비 합계 ${DATA.game.locations.filter((l) => l.id !== 'colony').reduce((a, l) => a + g.locs[l.id].z, 0)} · 피난기지 바리케이드 ${g.locs.colony.entrances.reduce((a, e) => a + e.b, 0)} · 노약자 ${g.helpless}</div></section>
    <section><h4>쓰레기 규칙</h4><div class="row small"><span>쓰레기장 사기 감소 기준</span><button class="sm ${(g.wastePer || 10) === 10 ? 'pri' : ''}" data-a="setting.wastePer" data-p='${J({ n: 10 })}'>10장당</button><button class="sm ${g.wastePer === 15 ? 'pri' : ''}" data-a="setting.wastePer" data-p='${J({ n: 15 })}'>15장당 (애슐리 로스 크로스로드)</button></div></section>
    <section><div class="row"><button class="warn sm" data-a="game.end" data-p='${J({ win: false })}' data-confirm="게임을 패배로 끝낼까요? (겨울이 왔다에서 연료를 못 놓은 경우 등)">패배로 종료</button><button class="sm" data-a="game.end" data-p='${J({ win: true })}' data-confirm="공동목표 달성으로 게임을 끝낼까요?">승리로 종료</button></div></section>`;
};

M.fetch = (g, m) => {
  const src = m.src || 'waste';
  const my = me();
  let list = [];
  if (src === 'waste') list = g.waste; else if (src === 'removed') list = g.removed;
  const deckNote = src !== 'waste' && src !== 'removed';
  return `<h2>카드 찾기</h2><div class="small muted">크로스로드·능력 효과로 덱이나 더미에서 특정 카드를 가져올 때 씁니다.</div>
    <section><div class="row"><select id="fc-src">
      <option value="waste" ${src === 'waste' ? 'selected' : ''}>쓰레기장 (${g.waste.length})</option>
      <option value="removed" ${src === 'removed' ? 'selected' : ''}>게임에서 제거된 카드 (${g.removed.length})</option>
      ${DATA.game.locations.filter((l) => l.id !== 'colony').map((l) => `<option value="${l.id}" ${src === l.id ? 'selected' : ''}>${esc(l.name)} 덱 (${g.locs[l.id].deckCount})</option>`).join('')}
    </select></div></section>
    ${deckNote ? `<section><div class="small muted">장소 덱은 비공개라 여기서 고를 수 없습니다. 탐색을 시작한 뒤 "능력·장비로 1장 더"로 원하는 카드가 나올 때까지 넘기거나, 덱 내용이 필요하면 서로 합의해 진행하세요.</div><button class="sm" data-a="search.start" data-p='${J({ loc: src })}' data-close="1">${esc(LOC[src].name)} 덱 넘겨 보기 시작</button></section>`
      : `<section><div class="row"><select id="fc-card" class="grow"><option value="">카드 선택</option>${[...list].reverse().map((c) => `<option value="${c}">${esc(TPL[g.cards[c].t].name)} · ${esc(KINDS[TPL[g.cards[c].t].kind])}</option>`).join('')}</select><button class="pri sm" data-ui="fetchCard">내 손으로</button></div></section>`}`;
};

M.recruit = (g) => `<h2>생존자 합류</h2><div class="small muted">외부인 카드나 크로스로드로 생존자를 추가할 때 씁니다. 비워 두면 생존자 덱 맨 위 카드를 뽑습니다. (덱 ${g.survivorDeckCount}장)</div>
  <section><div class="row"><select id="rc-id"><option value="">덱 맨 위 (무작위)</option>${DATA.survivors.filter((s) => !s.noncoop && !g.survivors[s.id] && !(g.dead || []).includes(s.id)).map((s) => `<option value="${s.id}">${esc(s.name)} (지정 · 덱에서 찾기)</option>`).join('')}</select>
  <select id="rc-to">${locOptions(g)}</select><button class="pri sm" data-ui="recruitGo">내 추종자로 추가</button></div></section>`;

M.lure = (g) => `<h2>좀비 유인</h2><div class="small muted">주사위 1개(아무 눈)를 사용 표시한 뒤, 아무 장소의 좀비 2마리를 내 생존자가 있는 장소의 빈 입구 칸으로 옮깁니다.</div>
  <section><div class="row"><span class="small">어디서</span><select id="lu-from">${DATA.game.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
  <span class="small">어디로</span><select id="lu-to">${DATA.game.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><button class="pri sm" data-ui="lureGo">2마리 옮기기</button></div></section>`;

M.rules = () => {
  modal.wide = true;
  return `<div class="rules"><h2>규칙 요약 · 2인 협력</h2>
  <h3>승리와 패배</h3><p>공동목표를 피난기지 단계 ⑤에서 확인해 달성하면 승리. 사기 0이 되거나 라운드가 0이 되면 즉시 패배합니다.</p>
  <h3>라운드 진행</h3><ol><li><b>위기 공개</b> → <b>주사위 굴림</b>(1 + 내 생존자 수, 노약자 제외) → <b>각자 턴</b>(시작 플레이어부터).</li>
  <li>턴 시작 시 상대가 크로스로드 1장을 비공개로 뽑습니다. 조건이 맞으면 상대가 소리 내어 읽고, 내가 선택합니다. 발동 안 된 카드는 덱 아래로.</li>
  <li>턴 시작 시 동상이 있는 내 생존자마다 부상 +1 (자동).</li>
  <li><b>피난기지 단계</b>: 식량 ⌈(피난기지 생존자+노약자)/2⌉ 지불 → 쓰레기 10장마다 사기 −1 → 위기 해결 → 좀비 추가 → 공동목표 확인 → 라운드 −1 → 시작 플레이어 교대.</li></ol>
  <h3>주사위가 필요한 행동</h3><ul><li><b>공격</b>: 공격력 이상 주사위. 좀비 1마리 처치 후 위험노출 굴림. 피난기지에서는 어느 입구든.</li>
  <li><b>탐색</b>: 탐색력 이상 주사위, 피난기지 외. 1장 보고 → 멈추거나 소음 토큰을 놓고 1장 더(최대 4). 본 카드 중 1장만 갖고 나머지는 덱 아래.</li>
  <li><b>바리케이드</b>·<b>쓰레기 청소</b>(3장 제거)·<b>좀비 유인</b>(2마리): 아무 눈 주사위.</li><li><b>생존자 능력</b>: 표시된 눈 이상.</li></ul>
  <h3>주사위가 필요 없는 행동</h3><ul><li>카드 사용(자기 턴), 위기에 카드 기여(뒷면), 이동(생존자마다 턴당 1회, 위험노출 굴림), 식량 토큰 1개로 주사위 +1, 상대에게 카드 요청(받으면 즉시 사용), 장착 카드 긴급 전달.</li></ul>
  <h3>위험노출 주사위 (12면)</h3><p>빈칸 6 · 부상 3 · 동상 2 · 물림 1. 동상은 매 턴 시작마다 부상 +1. 부상 3개(버디 4개)면 사망, 사망마다 사기 −1. 물림은 즉사하고 같은 장소의 영향력 최저 생존자에게 확산 — 대상은 "죽기" 또는 "재굴림(빈칸만 생존)" 중 선택.</p>
  <h3>위기 해결</h3><p>기여 카드를 섞어 공개, 맞는 종류 +1 · 틀린 종류 −1. 2인에서는 <b>2점 이상이면 성공</b>, <b>4점 이상이면 사기 +1</b>. 기여 카드는 게임에서 제거.</p>
  <h3>좀비 배치</h3><p>1마리씩, 피난기지는 입구 1→6 순서로 매번 입구 1부터. 칸이 차면 바리케이드 1개 파괴, 바리케이드도 없으면 <b>침입</b>: 그 장소 영향력 최저 생존자 사망(피난기지에 노약자만 있으면 노약자). 소음은 토큰마다 주사위 3 이하면 좀비 1.</p>
  <h3>그 밖에</h3><ul><li>모든 동점과 동시 효과 순서는 시작 플레이어가 정합니다.</li><li>카드 문구가 규칙과 다르면 카드가 우선합니다.</li><li>진행 중인 효과를 끊고 약을 쓸 수 없습니다 — 부상은 미리 치료하세요.</li>
  <li>마지막 생존자를 잃으면 손패를 모두 제거하고 새 생존자를 뽑아 리더로 삼습니다 (자동).</li></ul></div>`;
};

// ═══════════════════════ 실물 테이블 화면 (업로드 이미지 사용) ═══════════════════════
const KIND_ICON = { weapon: '⚔', fuel: '⛽', book: '📖', food: '🥫', medicine: '✚', tool: '🔧', outsider: '👤' };
const KIND_KEY = { '무기': 'weapon', '연료': 'fuel', '서적': 'book', '식량': 'food', '약': 'medicine', '도구': 'tool', '외부인': 'outsider' };
const IMG = () => DATA.images || { survivors: {}, crises: {}, objectives: {}, crossroads: {}, board: {}, tokens: {}, locations: {} };
const A_ = (p) => (p ? '/' + p : '');
const tok = (k) => A_(IMG().tokens[k]);
const cardSrc = (g, id) => A_(g.cards[id] && g.cards[id].img);
const survCardSrc = (id) => A_(IMG().survivors[id]?.card);
const portraitSrc = (id) => A_(IMG().survivors[id]?.portrait);

// 보드 이미지 좌표(%) — colony_board.jpg 1524×1980 기준
const CB = {
  trackY: (v) => ((272 + (10 - v) * 154.8) / 1980) * 100,
  roundX: 5.6, moraleX: 94.4,
  objective: { l: 14.1, t: 30.6, w: 29.9, h: 32.3 },
  waste: { l: 57.1, t: 30.6, w: 29.9, h: 32.3 },
  crisis: { l: 14.1, t: 65.7, w: 29.9, h: 32.3 },
  contrib: { l: 45.9, t: 70.2, w: 42, h: 23 },
};
// colony_occupants_21_spaces.jpg 512×1216 — 3열×7행
const OCC = { x: [13.7, 46.9, 81.6], y: [7.6, 21.8, 36, 50.3, 64.6, 78.8, 92.9], d: 27 };
const box = (r) => `left:${r.l}%;top:${r.t}%;width:${r.w}%;height:${r.h}%`;

function icard(id, g, extra = '') {
  const t = TPL[g.cards[id].t];
  return `<button class="pcard item ${extra}" data-ui="card" data-p='${J({ id })}' title="${esc(t.name)} — ${esc(t.text)}"><img src="${cardSrc(g, id)}" alt="${esc(t.name)}" loading="lazy"><span class="pc-ko">${esc(t.name)}</span></button>`;
}
const itemBack = (cls = '') => `<span class="pcard back ${cls}"><img src="${A_(IMG().board.itemBack)}" alt="카드 뒷면"></span>`;

function woundTokens(s) {
  const w = `<img class="tk-w" src="${tok('wound')}" alt="부상">`, f = `<img class="tk-w" src="${tok('frost')}" alt="동상">`;
  return w.repeat(s.wounds) + f.repeat(s.frost);
}

// 보드 위 생존자 말(원형 초상 토큰)
function standee(id, g) {
  const s = g.survivors[id]; const sv = SURV[id];
  return `<button class="pawn p${s.owner} ${s.moved ? 'moved' : ''}" data-ui="surv" data-p='${J({ id })}' title="${esc(sv.name)} · ${esc(pname(s.owner))} · 영향력 ${sv.inf} · 공격 ${sv.atk}+ · 탐색 ${sv.srch}+">
    <img src="${portraitSrc(id)}" alt="${esc(sv.name)}">${s.leader ? '<span class="pawn-lead">★</span>' : ''}
    ${s.wounds || s.frost ? `<span class="pawn-w">${woundTokens(s)}</span>` : ''}<span class="pawn-nm">${esc(sv.name.split(' ')[0])}</span></button>`;
}
const helplessTk = () => `<span class="pawn helpless" title="노약자"><img src="${tok('helpless')}" alt="노약자"></span>`;
const zTk = () => `<img class="tk-z" src="${tok('zombie')}" alt="좀비">`;
const bTk = () => `<img class="tk-b" src="${tok('barricade')}" alt="바리케이드">`;
function entranceSlots(z, b, cap) {
  let h = '';
  for (let i = 0; i < cap; i++) h += `<span class="eslot">${i < z ? zTk() : i < z + b ? bTk() : ''}</span>`;
  return h;
}

function renderColony(g) {
  const col = g.locs.colony;
  const occ = survsAt(g, 'colony');
  const items = occ.map((id) => standee(id, g)).concat(Array.from({ length: g.helpless }, helplessTk));
  let occHtml = '';
  for (let i = 0; i < 21; i++) {
    const r = Math.floor(i / 3), c = i % 3;
    occHtml += `<div class="occ-slot" style="left:${OCC.x[c]}%;top:${OCC.y[r]}%;width:${OCC.d}%">${items[i] || ''}</div>`;
  }
  const overflow = items.length > 21 ? `<div class="occ-over">+${items.length - 21}</div>` : '';
  const ent = (i) => { const e = col.entrances[i]; return `<button class="gate" data-ui="loc" data-p='${J({ id: 'colony' })}' title="입구 ${i + 1}"><span class="gate-n">${i + 1}</span><span class="gate-slots">${entranceSlots(e.z, e.b, 3)}</span></button>`; };
  const side = OBJ[g.settings.objective].sides[g.settings.side];
  const objImg = A_(IMG().objectives[g.settings.objective]?.[g.settings.side]);
  const trackBtns = (kind, key, cur, x) => Array.from({ length: 11 }, (_, v) =>
    `<button class="track-hit" style="left:${x}%;top:${CB.trackY(v)}%" data-a="track" data-p='${J({ key, d: v - cur })}' title="${kind === 'round' ? '라운드' : '사기'} ${v}로"></button>`).join('');
  const topWaste = g.waste.length ? g.waste[g.waste.length - 1] : null;
  const c = g.crisis ? CRISIS[g.crisis.id] : null;
  return `<section class="colony-area">
    <div class="gates">${ent(0)}${ent(1)}${ent(2)}</div>
    <div class="colony-mid">
      <div class="cboard"><img class="cboard-img" src="${A_(IMG().board.colony)}" alt="피난기지 보드">
        ${trackBtns('round', 'round', g.round, CB.roundX)}${trackBtns('morale', 'morale', g.morale, CB.moraleX)}
        <img class="marker" src="${tok('round')}" style="left:${CB.roundX}%;top:${CB.trackY(g.round)}%" alt="라운드 마커" title="라운드 ${g.round}">
        <img class="marker" src="${tok('morale')}" style="left:${CB.moraleX}%;top:${CB.trackY(g.morale)}%" alt="사기 마커" title="사기 ${g.morale}">
        <button class="cb-zone" style="${box(CB.objective)}" data-ui="objective" title="공동목표">${objImg ? `<img class="zone-card" src="${objImg}" alt="공동목표">` : ''}
          ${g.underObjective.length ? `<span class="zone-badge">아래 ${g.underObjective.length}장</span>` : ''}${side.tracker === 'samples' ? `<span class="zone-badge b2">샘플 ${g.samples}/${side.targetPerPlayer * 2}</span>` : ''}</button>
        <button class="cb-zone" style="${box(CB.waste)}" data-ui="loc" data-p='${J({ id: 'colony' })}' title="쓰레기장">${topWaste ? `<img class="zone-card stack" src="${cardSrc(g, topWaste)}" alt="쓰레기장">` : ''}
          <span class="zone-badge ${g.waste.length >= 10 ? 'warn' : ''}">쓰레기 ${g.waste.length}</span></button>
        <button class="cb-zone" style="${box(CB.crisis)}" data-ui="crisis" title="위기">${c ? `<img class="zone-card" src="${A_(IMG().crises[g.crisis.id])}" alt="${esc(c.name)}">` : ''}<span class="zone-badge">덱 ${g.crisisDeckCount}</span></button>
        <button class="cb-zone contrib" style="${box(CB.contrib)}" data-ui="crisis" title="위기 기여 카드">
          ${g.crisis ? `<span class="fan">${Array.from({ length: g.crisis.count }, (_, i) => `<img src="${A_(IMG().board.itemBack)}" style="--i:${i}" alt="">`).join('')}</span>${g.crisis.count ? `<span class="zone-badge">${g.crisis.count}장</span>` : ''}` : ''}</button>
      </div>
      <div class="occ-board"><img src="${A_(IMG().board.occupants)}" alt="피난기지 생존자 칸">${occHtml}${overflow}
        <span class="occ-count">${g.calc.colonyPop}/21</span></div>
    </div>
    <div class="gates">${ent(3)}${ent(4)}${ent(5)}</div>
    <div class="supply-row">
      <div class="supply"><span class="sup-lab">식량 공급처</span>
        <span class="pile">${Array.from({ length: Math.min(g.food, 12) }, (_, i) => `<img src="${tok('food')}" style="--i:${i}" alt="식량">`).join('')}</span><b class="sup-n">${g.food}</b>
        <button class="tbtn" data-a="track" data-p='${J({ key: 'food', d: 1 })}' title="식량 +1">+</button><button class="tbtn" data-a="track" data-p='${J({ key: 'food', d: -1 })}' title="식량 −1">−</button>
        <span class="sup-need">이번 라운드 필요 ${g.calc.foodNeeded}</span></div>
      <div class="supply"><span class="sup-lab">굶주림</span>
        <span class="pile">${Array.from({ length: g.starvation }, (_, i) => `<img src="${tok('starve')}" style="--i:${i}" alt="굶주림">`).join('') || '<span class="faint tiny">없음</span>'}</span>
        <button class="tbtn" data-a="track" data-p='${J({ key: 'starvation', d: 1 })}'>+</button><button class="tbtn" data-a="track" data-p='${J({ key: 'starvation', d: -1 })}'>−</button></div>
      <div class="supply"><span class="sup-lab">노약자</span><img class="sup-ic" src="${tok('helpless')}" alt=""><b class="sup-n">${g.helpless}</b>
        <button class="tbtn" data-a="track" data-p='${J({ key: 'helpless', d: 1 })}'>+</button><button class="tbtn" data-a="track" data-p='${J({ key: 'helpless', d: -1 })}'>−</button></div>
    </div>
  </section>`;
}

function symbolsHtml(l) {
  return l.symbols.split('>').map((s) => s.trim()).map((s) => `<span class="sym k-${KIND_KEY[s]}" title="${esc(s)}">${esc(s)}</span>`).join('');
}

function renderLocation(g, l) {
  const s = g.locs[l.id];
  const ss = survsAt(g, l.id);
  let slots = '';
  for (let i = 0; i < l.slots; i++) slots += `<span class="ls-slot">${ss[i] ? standee(ss[i], g) : ''}</span>`;
  return `<section class="loc-card ${s.searched ? 'searched' : ''}">
    <button class="lc-art" data-ui="loc" data-p='${J({ id: l.id })}' style="background-image:url('${A_(IMG().locations[l.id])}')">
      <span class="lc-name"><span class="lnum">${l.no}</span>${esc(l.name)}</span><span class="syms">${symbolsHtml(l)}</span></button>
    <div class="lc-body">
      <div class="lc-survs">${slots}</div>
      <button class="lc-deck" data-ui="loc" data-p='${J({ id: l.id })}' title="${esc(l.name)} 아이템 덱 ${s.deckCount}장" style="background-image:url('${A_(IMG().board.searchPanel)}')">
        ${s.deckCount ? `<span class="deck-stack">${itemBack()}${s.deckCount > 1 ? itemBack('under') : ''}</span>` : ''}<span class="deck-n">${s.deckCount}</span></button>
    </div>
    <button class="lc-ent" data-ui="loc" data-p='${J({ id: l.id })}'>
      <span class="lc-lab">입구</span><span class="gate-slots">${entranceSlots(s.z, s.b, l.entranceSlots)}</span>
      <span class="lc-lab">소음</span><span class="noise-slots">${Array.from({ length: l.noise }, (_, i) => `<span class="nslot">${i < s.noise ? `<img src="${tok('noise')}" alt="소음">` : ''}</span>`).join('')}</span>
    </button>
  </section>`;
}

function renderTable(g) {
  const L = (id) => renderLocation(g, LOC[id]);
  return `<div class="table-board">
    <div class="tb-col">${L('police')}${L('grocery')}${L('school')}</div>
    <div class="tb-center">${renderColony(g)}</div>
    <div class="tb-col">${L('library')}${L('hospital')}${L('gas')}</div>
  </div>`;
}

// 생존자 카드(실물 카드 이미지) + 위에 놓인 토큰, 아래로 삐져나온 장착 카드
function survivorOnSheet(id, g, cls) {
  const s = g.survivors[id]; const sv = SURV[id];
  const eq = s.equip.map((c, i) => `<img class="tucked ${(s.equipUsed || []).includes(c) ? 'spent' : ''}" src="${cardSrc(g, c)}" style="--i:${i}" title="${esc(TPL[g.cards[c].t].name)} 장착" alt="">`).join('');
  return `<button class="scard-wrap ${cls} p${s.owner}" data-ui="surv" data-p='${J({ id })}' title="${esc(sv.name)}">
    ${eq ? `<span class="tucks" style="--n:${s.equip.length}">${eq}</span>` : ''}
    <span class="pcard surv"><img src="${survCardSrc(id)}" alt="${esc(sv.name)}">
      <span class="on-card">${woundTokens(s)}</span>
      ${s.used ? '<span class="sc-flag">능력 사용</span>' : ''}
      <span class="sc-loc">${s.moved ? '이동함 · ' : ''}📍${esc(LOC[s.loc].name)}</span></span>
    ${s.notes.length ? `<span class="sc-notes">${s.notes.map((n) => '📎 ' + esc(n)).join('<br>')}</span>` : ''}
  </button>`;
}

function dieFace(v) {
  const P = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[v] || [];
  return Array.from({ length: 9 }, (_, i) => `<i class="${P.includes(i + 1) ? 'p' : ''}"></i>`).join('');
}

function renderPlayerArea(g, seat) {
  const mine = seat === me();
  const p = g.players[seat];
  const ids = Object.keys(g.survivors).filter((id) => g.survivors[id].owner === seat).sort((a, b) => SURV[b].inf - SURV[a].inf);
  const leader = ids.find((id) => g.survivors[id].leader);
  const followers = ids.filter((id) => id !== leader);
  const die = (d, i) => mine ? `<button class="die6 ${d.used ? 'used' : ''}" data-ui="die" data-p='${J({ i })}' title="${d.v}">${dieFace(d.v)}</button>` : `<span class="die6 ${d.used ? 'used' : ''}" title="${d.v}">${dieFace(d.v)}</span>`;
  const unused = p.dice.map((d, i) => [d, i]).filter(([d]) => !d.used).map(([d, i]) => die(d, i)).join('');
  const used = p.dice.map((d, i) => [d, i]).filter(([d]) => d.used).map(([d, i]) => die(d, i)).join('');
  const isTurn = g.stage === 'player' && g.turn === seat;
  let xr = '';
  if (g.xr && g.xr.by === seat && !g.xr.revealed) {
    xr = mine
      ? `<button class="xr-hold" data-ui="xr" title="내가 든 크로스로드 — 눌러서 읽기/발동"><img src="${A_(IMG().crossroads[g.xr.id])}" alt="크로스로드"><span class="xr-tag">→ ${esc(pname(g.xr.for))} · 조건이 맞으면 발동</span></button>`
      : `<span class="xr-hold back" title="크로스로드(비공개)"><span class="xr-back">CROSSROADS</span><span class="xr-tag">상대가 든 크로스로드</span></span>`;
  }
  const hand = (mine || p.hand)
    ? (p.hand || []).map((c) => icard(c, g)).join('')
    : Array.from({ length: p.handCount }, () => itemBack()).join('');
  return `<section class="parea ${mine ? 'mine' : 'theirs'} p${seat} ${isTurn ? 'turn' : ''}">
    <header class="pa-head"><span class="dot ${R.seats[seat]?.online ? 'on' : ''}"></span><b>${esc(pname(seat))}${mine ? ' (나)' : ''}</b>
      ${g.startPlayer === seat ? `<img class="fp-token" src="${tok('firstPlayer')}" alt="시작 플레이어" title="시작 플레이어 토큰">` : ''}${isTurn ? '<span class="turn-tag">턴 진행 중</span>' : ''}
      <span class="spacer"></span>${mine ? `${p.search ? '<button class="sm pri" data-ui="search">탐색 중…</button>' : ''}<button class="sm ghost" data-a="hand.reveal">${p.handOpen ? '🔓 손패 공개 중' : '🔒 손패 비공개'}</button>` : `<span class="small muted">손패 ${p.handCount}장${p.search ? ` · ${esc(LOC[p.search.loc].name)} 탐색 중` : ''}</span>`}</header>
    <div class="pa-top">
      <div class="pa-leader">${leader ? survivorOnSheet(leader, g, 'leader') : '<div class="empty-card">리더 없음</div>'}</div>
      <div class="ref-sheet"><img src="${A_(IMG().board.sheet)}" alt="플레이어 참조판">
        <div class="dice-box unused">${unused}</div><div class="dice-box usedb">${used}</div>
        ${mine ? `<span class="dice-ctrl"><button class="tbtn" title="주사위 추가" data-a="dice.add" data-p='${J({ d: 1 })}'>+</button><button class="tbtn" title="주사위 제거" data-a="dice.add" data-p='${J({ d: -1 })}'>−</button></span>` : ''}
      </div>
      <div class="pa-followers">${followers.map((id) => survivorOnSheet(id, g, 'follower')).join('')}</div>
    </div>
    <div class="pa-hand">${xr}<div class="hand-fan">${hand || '<span class="faint small">손패 없음</span>'}</div></div>
  </section>`;
}

function renderTop(g) {
  return `<div class="topbar">
    <span class="title">겨울의 생존자들</span>
    <span class="pill">방 ${esc(R.code)}</span>
    <span class="pill">${g.phase === 'ended' ? '게임 종료' : g.stage === 'colony' ? '피난기지 단계' : `${esc(pname(g.turn))}의 턴`}</span>
    <span class="spacer"></span>
    <button class="sm" data-ui="objective">공동목표</button>
    <button class="sm" data-ui="rules">규칙 요약</button>
    <button class="sm" data-ui="undo" ${R.canUndo ? '' : 'disabled'} title="마지막 행동 되돌리기">↶ 되돌리기</button>
    <button class="sm ghost" data-ui="abandon">게임 포기</button>
  </div>`;
}

function renderDecks(g) {
  return `<div class="panel decks"><span class="small muted">크로스로드 덱 <b>${g.xrDeckCount}</b> · 생존자 덱 <b>${g.survivorDeckCount}</b></span>
    <span class="spacer"></span><button class="sm" data-ui="recruit">생존자 합류</button><button class="sm" data-ui="lure">좀비 유인</button></div>`;
}

function renderGame() {
  const g = G();
  const chatVal = document.getElementById('chat')?.value || '';
  const hadFocus = document.activeElement?.id === 'chat';
  const scroll = window.scrollY;
  const my = me();
  $app.innerHTML = `${renderTop(g)}
  <div class="table-wrap">
    <div class="felt">
      ${renderPlayerArea(g, 1 - my)}
      ${bannersHtml(g)}
      ${renderTable(g)}
      ${renderPlayerArea(g, my)}
    </div>
    <aside class="side"><div class="phase-slot">${renderPhase(g)}</div>${g.xr && g.xr.revealed ? `<div class="panel"><div class="banner gold" style="margin:0">⚡ 「${esc(XR[g.xr.id].name)}」 발동 중 <button class="sm pri" data-ui="xr">카드 보기</button></div></div>` : ''}${renderDecks(g)}${logHtml(g)}</aside>
  </div>`;
  const ci = document.getElementById('chat');
  if (ci) { ci.value = chatVal; if (hadFocus) ci.focus(); ci.addEventListener('keydown', (e) => { if (e.key === 'Enter') UI.chat(); }); }
  window.scrollTo(0, scroll);
  const ms = g.players[my].search;
  const sKey = ms ? ms.loc + ms.cards[0] : null;
  if (sKey && renderGame.lastSearch !== sKey && !modal) { ui.searchSel = []; modal = { kind: 'search' }; }
  renderGame.lastSearch = sKey;
  if (g.xr && g.xr.revealed && renderGame.lastXR !== g.xr.id) { renderGame.lastXR = g.xr.id; if (!modal) modal = { kind: 'xr' }; }
}

UI.crisis = () => openModal({ kind: 'crisis' });

// ─────────── 실물 카드 이미지를 쓰는 조작 창 ───────────
const bigCard = (src, alt, cls = '') => src ? `<img class="big-card ${cls}" src="${src}" alt="${esc(alt)}">` : '';
const twoCol = (left, right) => `<div class="mcols"><div class="mcol-img">${left}</div><div class="mcol-body">${right}</div></div>`;

M.crisis = (g) => {
  modal.wide = true;
  if (!g.crisis) return `<h2>위기</h2><div class="small muted">이번 라운드 위기는 처리되었습니다. (위기 덱 ${g.crisisDeckCount}장)</div>${g.crisisResolved ? crisisResultHtml(g) : ''}`;
  const c = CRISIS[g.crisis.id];
  return twoCol(bigCard(A_(IMG().crises[g.crisis.id]), c.name), `<h2>위기 · ${esc(c.name)}</h2>
    <div class="row" style="margin:6px 0"><span class="small muted">예방 종류</span><span class="need">${c.need.map((k) => `<span class="k-${k}">${KIND_ICON[k]} ${esc(KINDS[k])}</span>`).join('')}</span></div>
    <div class="ability">맞는 카드 +1 · 다른 카드 −1. 2인에서는 <b>2점</b> 이상이면 막고, <b>4점</b> 이상이면 사기 +1.</div>
    <section><h4>실패하면</h4><div class="ability" style="border-color:#86403a;color:#ffcfc9">${esc(c.fail)}</div></section>
    <section><h4>기여된 카드 (뒷면) · ${g.crisis.count}장</h4><div class="row">${Array.from({ length: g.crisis.count }, () => itemBack('mini')).join('') || '<span class="faint small">아직 없음</span>'}</div>
      ${g.crisis.mine.length ? `<div class="tiny faint" style="margin-top:4px">내가 낸 카드: ${g.crisis.mine.map((id) => esc(TPL[g.cards[id].t].name)).join(', ')}</div>` : ''}
      <div class="small muted" style="margin-top:6px">손패 카드를 눌러 "위기에 기여"를 고르면 뒷면으로 놓입니다.</div></section>
    <section><button class="sm ghost" data-a="crisis.skip" data-close="1" data-confirm="현재 위기를 덱 맨 아래로 보내고 이번 라운드 위기 해결을 건너뛸까요? (카드 효과용)">위기 건너뛰기 (카드 효과)</button></section>`);
};

M.loc = (g, { id }) => {
  const l = LOC[id];
  if (id === 'colony') {
    const es = g.locs.colony.entrances;
    return `<h2>피난기지</h2><div class="small muted">좀비는 입구 1→6 순서로 1마리씩 놓입니다. 칸이 차면 바리케이드가 부서지고, 바리케이드도 없으면 침입이 일어납니다.</div>
      <section><h4>입구</h4><div class="ent-edit">${es.map((e, i) => `<div class="ent-row"><span class="gate-n">${i + 1}</span><span class="gate-slots">${entranceSlots(e.z, e.b, 3)}</span>
        <button class="sm" data-a="zombie" data-p='${J({ loc: 'colony', d: -1, entrance: i })}'>좀비 −</button>
        <button class="sm" data-a="barricade" data-p='${J({ loc: 'colony', d: 1, entrance: i })}'>바리케이드 +</button>
        <button class="sm" data-a="barricade" data-p='${J({ loc: 'colony', d: -1, entrance: i })}'>바리케이드 −</button></div>`).join('')}</div></section>
      <section><h4>좀비 추가 (규칙대로 자동 배치)</h4><div class="row"><button class="sm" data-a="zombie" data-p='${J({ loc: 'colony', d: 1 })}'>+1</button><button class="sm" data-ui="addZ" data-p='${J({ loc: 'colony' })}'>+N마리</button></div></section>
      <section><h4>쓰레기장 · ${g.waste.length}장</h4><div class="row">${g.waste.slice(-6).map((c) => `<img class="mini-img" src="${cardSrc(g, c)}" alt="">`).join('')}</div>
        <div class="row" style="margin-top:6px"><button class="sm" data-a="waste.clean" data-p='${J({ n: 3 })}'>쓰레기 청소 (3장 제거)</button><button class="sm" data-a="waste.clean" data-p='${J({ n: 5 })}'>5장 제거 (브랜든·대걸레)</button></div></section>`;
  }
  const s = g.locs[id];
  return `<div class="loc-hero" style="background-image:url('${A_(IMG().locations[id])}')"><h2><span class="lnum">${l.no}</span> ${esc(l.name)}</h2></div>
    <div class="row small muted" style="margin-top:8px">많이 나오는 순서: <span class="syms">${symbolsHtml(l)}</span></div>
    <div class="row" style="margin-top:8px"><span class="stat"><b>${survsAt(g, id).length}/${l.slots}</b><span>생존자 칸</span></span><span class="stat"><b>${s.z}</b><span>좀비</span></span><span class="stat"><b>${s.b}</b><span>바리케이드</span></span><span class="stat"><b>${s.noise}/${l.noise}</b><span>소음</span></span><span class="stat"><b>${s.deckCount}</b><span>아이템 덱</span></span></div>
    <section><h4>입구 (${l.entranceSlots}칸)</h4><div class="row"><span class="gate-slots big">${entranceSlots(s.z, s.b, l.entranceSlots)}</span></div>
      <div class="row" style="margin-top:6px"><button class="sm" data-a="zombie" data-p='${J({ loc: id, d: 1 })}'>좀비 +</button><button class="sm" data-a="zombie" data-p='${J({ loc: id, d: -1 })}'>좀비 −</button>
      <button class="sm" data-ui="addZ" data-p='${J({ loc: id })}'>좀비 +N</button>
      <button class="sm" data-a="barricade" data-p='${J({ loc: id, d: 1 })}'>바리케이드 +</button><button class="sm" data-a="barricade" data-p='${J({ loc: id, d: -1 })}'>바리케이드 −</button></div></section>
    <section><h4>소음</h4><div class="row"><span class="noise-slots big">${Array.from({ length: l.noise }, (_, i) => `<span class="nslot">${i < s.noise ? `<img src="${tok('noise')}" alt="">` : ''}</span>`).join('')}</span><button class="sm" data-a="noise" data-p='${J({ loc: id, d: 1 })}'>소음 +</button><button class="sm" data-a="noise" data-p='${J({ loc: id, d: -1 })}'>소음 −</button></div></section>
    <section><div class="small muted">탐색은 이 장소에 있는 내 생존자 말을 눌러서 시작하세요.</div></section>`;
};

// 카드 창: 왼쪽 실물 카드, 오른쪽 한글 효과와 버튼
const _cardBody = M.card;
M.card = (g, m) => {
  if (!g.cards[m.id]) return null;
  const body = _cardBody(g, m);
  if (body == null) return null;
  modal.wide = true;
  return twoCol(bigCard(cardSrc(g, m.id), TPL[g.cards[m.id].t].name), body);
};
const _survBody = M.surv;
M.surv = (g, m) => {
  const body = _survBody(g, m);
  if (body == null) return null;
  modal.wide = true;
  const s = g.survivors[m.id];
  return twoCol(`${bigCard(survCardSrc(m.id), SURV[m.id].name)}<div class="row" style="margin-top:8px;justify-content:center"><img class="portrait-lg p${s.owner}" src="${portraitSrc(m.id)}" alt=""><span class="on-card big">${woundTokens(s)}</span></div>`, body);
};
const _equipBody = M.equip;
M.equip = (g, m) => {
  const body = _equipBody(g, m);
  if (body == null) return null;
  modal.wide = true;
  return twoCol(bigCard(cardSrc(g, m.id), ''), body);
};
const _objBody = M.objective;
M.objective = (g) => {
  modal.wide = true;
  const src = A_(IMG().objectives[g.settings.objective]?.[g.settings.side]);
  const under = g.underObjective.length ? `<section><h4>목표 아래 카드</h4><div class="row">${g.underObjective.map((c) => `<img class="mini-img" src="${cardSrc(g, c)}" alt="">`).join('')}</div></section>` : '';
  return twoCol(bigCard(src, '공동목표'), _objBody(g) + under);
};
const _xrBody = M.xr;
M.xr = (g) => {
  const x = g.xr; if (!x || !x.id) return null;
  const body = _xrBody(g);
  if (body == null) return null;
  modal.wide = true;
  return twoCol(bigCard(A_(IMG().crossroads[x.id]), XR[x.id].name), body);
};
M.search = (g) => {
  const s = g.players[me()].search; if (!s) return null;
  modal.wide = true;
  const left = g.locs[s.loc].deckCount;
  return `<h2>${esc(LOC[s.loc].name)} 탐색</h2>
    <div class="small muted">본 카드 중 정확히 1장(능력·설계도로 추가 획득 시 그만큼)을 골라 가져가세요. 나머지는 덱 맨 아래로 갑니다.</div>
    <div class="search-row">${s.cards.map((c) => `<button class="pcard item lg ${ui.searchSel.includes(c) ? 'sel' : ''}" data-ui="searchSel" data-p='${J({ id: c })}' title="${esc(TPL[g.cards[c].t].text)}"><img src="${cardSrc(g, c)}" alt=""><span class="pc-ko">${esc(TPL[g.cards[c].t].name)}</span></button>`).join('')}</div>
    <section><div class="row">
      <button data-a="search.more" data-p='${J({ noise: true })}' ${g.locs[s.loc].noise >= LOC[s.loc].noise || !left ? 'disabled' : ''}><img src="${tok('noise')}" class="btn-ic" alt=""> 소음 토큰 놓고 1장 더 (${g.locs[s.loc].noise}/${LOC[s.loc].noise})</button>
      <button data-a="search.more" data-p='${J({ noise: false })}' ${left ? '' : 'disabled'}>능력·장비로 1장 더</button>
      <span class="small muted">남은 덱 ${left}장</span></div></section>
    <section><button class="pri" data-ui="searchTake">고른 ${ui.searchSel.length}장 가져가기</button></section>`;
};

// 준비 화면의 생존자 선택: 실물 카드
function survCard(id, opts = {}) {
  const s = SURV[id];
  return `<div class="pick ${opts.sel ? 'sel' : ''}" ${opts.ui ? `data-ui="${opts.ui}" data-p='${J({ id })}'` : ''}>
    <img src="${survCardSrc(id)}" alt="${esc(s.name)}">
    <div class="pick-ko"><b>${esc(s.name)}</b> · ${esc(s.job)}<br><span class="tiny">${esc(s.place)}${s.cost ? ` · ${esc(s.cost)}` : ''}${s.once ? ' · 라운드 1회' : ''} — ${esc(s.ability)}</span></div>
    ${opts.leaderBtn ? `<button class="sm ${opts.isLeader ? 'pri' : ''}" data-ui="leader" data-p='${J({ id })}'>★ 리더${opts.isLeader ? '' : '로'}</button>` : ''}
  </div>`;
}
