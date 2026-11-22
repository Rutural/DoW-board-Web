'use strict';
// 서버 통합 테스트: 실제 서버를 띄우고 소켓 두 개로 한 판 진행
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 3600 + Math.floor(Math.random() * 300);
const URL = `http://127.0.0.1:${PORT}`;
const SAVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dow-srv-'));
let srv;

function client() {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.last = null; s.toasts = [];
  s.on('state', (st) => { s.last = st; });
  s.on('toast', (t) => s.toasts.push(t));
  s.on('joined', (j) => { s.joined = j; });
  return s;
}
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(25); }
  throw new Error('시간 초과');
}

// 테스트용 모델: 특징값 정의와 맞는 가짜 로지스틱 회귀
const FEAT = require('../ml/features');
function fakeModel(task, version, bias) {
  const n = FEAT.FEATURE_NAMES.length;
  return { format: 'dow-logreg-v1', task, version, schema: FEAT.SCHEMA_VERSION, feature_names: FEAT.FEATURE_NAMES,
    mean: Array(n).fill(0), scale: Array(n).fill(1), coef: Array(n).fill(0), intercept: bias, trained_at: 'test', metrics: {} };
}
function writeRegistry(versions) {
  const root = path.join(SAVE_DIR, 'store');
  const reg = { schema: 1, tasks: {}, models: {}, events: [] };
  for (const [task, version, bias] of versions) {
    const key = `models/${task}/${version}.json`;
    fs.mkdirSync(path.join(root, 'models', task), { recursive: true });
    fs.writeFileSync(path.join(root, key), JSON.stringify(fakeModel(task, version, bias)));
    reg.tasks[task] = { active: version, history: [version] };
    reg.models[version] = { task, artifact: key, status: 'active' };
  }
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify(reg));
}

test.before(async () => {
  writeRegistry([['y_crisis', 'crisis-v1', 0], ['y_collapse', 'collapse-v1', 0]]);
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), SAVE_DIR, GIT_SHA: 'test-sha', MODEL_POLL_S: '1' }, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL + '/healthz'); if (r.ok) return; } catch {} await wait(100); }
  throw new Error('서버가 뜨지 않음');
});
test.after(async () => {
  const exited = new Promise((r) => srv.once('exit', r));
  srv.kill('SIGTERM');
  await exited; // 서버가 종료 시 저장을 마칠 때까지 기다린 뒤 정리
  fs.rmSync(SAVE_DIR, { recursive: true, force: true });
});

test('헬스체크가 버전을 알려 준다', async () => {
  const j = await (await fetch(URL + '/healthz')).json();
  assert.equal(j.ok, true); assert.equal(j.version, 'test-sha');
});

test('방 생성 → 참가 → 게임 → 되돌리기 → 재접속 → 종료 기록 저장', async () => {
  const a = client(), b = client();
  a.emit('room.create', { name: 'A', settings: { objective: 'samples', side: 'hard' } });
  await until(() => a.last);
  b.emit('room.join', { code: a.last.code, name: 'B' });
  await until(() => b.last && a.last.seats[1]);
  a.emit('game.start');
  await until(() => a.last.game && b.last.game);
  for (const s of [a, b]) {
    const p = s.last.game.players[s.last.seat];
    s.emit('act', { type: 'setup.pick', payload: { picked: p.dealtSurvivors.slice(0, 3), leader: p.dealtSurvivors[0] } });
  }
  await until(() => a.last.game.phase === 'play' && b.last.game.phase === 'play');

  // 비공개 정보: 상대 손패는 null
  assert.equal(a.last.game.players[1].hand, null);
  assert.equal(b.last.game.players[0].hand, null);

  // 행동 + 되돌리기
  const food = a.last.game.food;
  a.emit('act', { type: 'track', payload: { key: 'food', d: 3 } });
  await until(() => a.last.game.food === food + 3);
  a.emit('undo');
  await until(() => a.last.game.food === food);

  // 종료 신호 없이도(비정상 종료 대비) 지연 저장이 파일에 남는다
  const saveFile = path.join(SAVE_DIR, 'rooms.json');
  await until(() => {
    try { return JSON.parse(fs.readFileSync(saveFile, 'utf8')).some((r) => r.code === a.last.code && r.game); } catch { return false; }
  }, 3000);

  // 잘못된 행동은 거부되고 상태는 그대로
  a.emit('act', { type: 'no.such.action', payload: {} });
  await until(() => a.toasts.some((t) => t.error));

  // 같은 토큰으로 재접속하면 같은 좌석
  const tok = b.joined.token; b.close();
  const b2 = client();
  b2.emit('room.resume', { code: a.last.code, token: tok });
  await until(() => b2.last);
  assert.equal(b2.last.seat, 1);

  // 종료 → 실제 게임 학습 기록 저장
  a.emit('act', { type: 'game.end', payload: { win: false, why: '테스트' } });
  await until(() => a.last.game.phase === 'ended');
  await wait(100);
  const realDir = path.join(SAVE_DIR, 'store', 'datasets', 'real');
  const day = fs.readdirSync(realDir);
  const files = fs.readdirSync(path.join(realDir, day[0]));
  assert.equal(files.length, 1);
  const row = JSON.parse(fs.readFileSync(path.join(realDir, day[0], files[0]), 'utf8').split('\n')[0]);
  assert.equal(row.source, 'real'); assert.equal(row.y_collapse, 1);
  assert.ok(row.pred && row.pred.y_crisis, '라운드 시작 시 운영 모델 예측이 함께 기록됨');
  a.close(); b2.close();
});

test('모델 API: 예측, 입력 검증, 새 모델 자동 교체(재배포 없이)', async () => {
  const x = Array(FEAT.FEATURE_NAMES.length).fill(1);
  let r = await fetch(URL + '/api/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x }) });
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.predictions[0].y_crisis.p, 0.5); // 절편 0 → 0.5
  assert.equal(j.predictions[0].y_crisis.version, 'crisis-v1');

  r = await fetch(URL + '/api/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: [1, 2] }) });
  assert.equal(r.status, 400, '특징값 개수가 틀리면 거부');

  // 레지스트리에서 active가 바뀌면 다음 확인 주기에 자동 적용
  writeRegistry([['y_crisis', 'crisis-v2', 2], ['y_collapse', 'collapse-v1', 0]]);
  for (let i = 0; i < 40; i++) {
    j = await (await fetch(URL + '/api/models')).json();
    if (j.tasks.y_crisis && j.tasks.y_crisis.version === 'crisis-v2') break;
    await wait(100);
  }
  assert.equal(j.tasks.y_crisis.version, 'crisis-v2');
  j = await (await fetch(URL + '/api/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x }) })).json();
  assert.ok(Math.abs(j.predictions[0].y_crisis.p - 1 / (1 + Math.exp(-2))) < 1e-6);
  const h = await (await fetch(URL + '/healthz')).json();
  assert.equal(h.models.y_crisis, 'crisis-v2');
});
