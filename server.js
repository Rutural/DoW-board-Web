'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const SAVE_DIR = process.env.SAVE_DIR || path.join(__dirname, 'saves');
const SAVE_FILE = path.join(SAVE_DIR, 'rooms.json');
const UNDO_LIMIT = 40;
const { openStore } = require('./ml/store');
const { createModelServer } = require('./ml/serving');
const FEAT = require('./ml/features');

// 저장소: 로컬 폴더(기본 saves/store) 또는 Lightsail 버킷(s3://버킷/접두사)
const store = openStore(process.env.DOW_STORE || path.join(SAVE_DIR, 'store'));
const models = createModelServer(store, { pollSeconds: +(process.env.MODEL_POLL_S || 60) });
models.start();

// 라운드가 새로 시작되면 운영 중인 모델로 예측해 기록 (화면 게이지 + 나중에 실제 성능 측정용)
function annotatePredictions(room) {
  const g = room.game;
  if (!g || !g.trace || !g.trace.length) return;
  const t = g.trace[g.trace.length - 1];
  if (t.pred !== undefined) return;
  const p = models.predictAll(t.x);
  t.pred = Object.keys(p).length ? p : null;
}

// 실제 게임이 끝나면 라운드별 학습 행을 저장소에 올림 → 학습 파이프라인이 가져감
async function exportRealGame(room) {
  const g = room.game;
  if (!g || g.phase !== 'ended' || g.exported) return;
  g.exported = true;
  try {
    const rows = G.exportRows(g, 'real', { room: room.code });
    if (!rows.length) return;
    const day = new Date().toISOString().slice(0, 10);
    await store.put(`datasets/real/date=${day}/${g.id}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`실제 게임 기록 저장: ${g.id} (${rows.length}행 → ${store.kind})`);
  } catch (e) { g.exported = false; console.error('게임 기록 저장 실패', e); }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/data.json', (req, res) => res.json(G.DATA));

// ── 모델 API ──
app.get('/api/models', (req, res) => res.json(models.info()));
app.post('/api/predict', (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : req.body && Array.isArray(req.body.x) ? [req.body.x] : null;
  if (!rows || !rows.length || rows.length > 1000) return res.status(400).json({ error: 'x(특징값 배열) 또는 rows(배열의 배열, 최대 1000)를 보내세요.', feature_names: FEAT.FEATURE_NAMES });
  if (rows.some((x) => !Array.isArray(x) || x.length !== FEAT.FEATURE_NAMES.length || !x.every(Number.isFinite))) return res.status(400).json({ error: `특징값은 숫자 ${FEAT.FEATURE_NAMES.length}개여야 합니다.` });
  if (!Object.keys(models.state.models).length) return res.status(503).json({ error: '운영 중인 모델이 없습니다.' });
  res.json({ predictions: rows.map((x) => models.predictAll(x)) });
});
app.post('/api/models/reload', async (req, res) => {
  if (!process.env.MODEL_RELOAD_TOKEN || req.get('x-reload-token') !== process.env.MODEL_RELOAD_TOKEN) return res.status(403).json({ error: '권한 없음' });
  await models.refresh(); res.json(models.info());
});
const STARTED = Date.now();
const VERSION = process.env.GIT_SHA || 'dev';
app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION, uptime_s: Math.round((Date.now() - STARTED) / 1000), rooms: rooms.size, models: Object.fromEntries(Object.entries(models.state.models).map(([t, m]) => [t, m.version])) }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 30000 });

// ───── 방 저장소 ─────
/** rooms: code → { code, seats:[{name, token}|null], settings, game, undo:[], updated } */
const ROOM_TTL_MS = +(process.env.ROOM_TTL_DAYS || 14) * 24 * 60 * 60 * 1000; // 이 기간 동안 손대지 않은 방은 저장 시 정리
let rooms = new Map();
try {
  if (fs.existsSync(SAVE_FILE)) {
    const arr = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    rooms = new Map(arr.map((r) => [r.code, r]));
    console.log(`복원한 방 ${rooms.size}개`);
  }
} catch (e) { console.error('저장 파일 읽기 실패', e); }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(SAVE_DIR, { recursive: true });
      const now = Date.now();
      for (const [k, r] of rooms) if (now - r.updated > ROOM_TTL_MS) rooms.delete(k);
      const tmp = SAVE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
      fs.renameSync(tmp, SAVE_FILE);
    } catch (e) { console.error('저장 실패', e); }
  }, 800);
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const token = () => crypto.randomBytes(16).toString('hex');

function seatOf(room, tok) { return room.seats.findIndex((s) => s && s.token === tok); }

function publicRoom(room, seat) {
  return {
    code: room.code,
    seat,
    seats: room.seats.map((s, i) => (s ? { name: s.name, online: onlineSeats(room).has(i) } : null)),
    settings: room.settings,
    canUndo: room.undo.length > 0,
    game: room.game ? G.viewFor(room.game, seat) : null,
  };
}

function onlineSeats(room) {
  const set = new Set();
  const sockets = io.sockets.adapter.rooms.get(room.code);
  if (sockets) for (const id of sockets) { const s = io.sockets.sockets.get(id); if (s && s.data.seat != null) set.add(s.data.seat); }
  return set;
}

function broadcast(room) {
  room.updated = Date.now();
  const sockets = io.sockets.adapter.rooms.get(room.code);
  if (sockets) for (const id of sockets) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('state', publicRoom(room, s.data.seat));
  }
  scheduleSave();
}

function sanitizeSettings(s = {}) {
  return {
    objective: G.OBJ[s.objective] ? s.objective : 'samples',
    side: s.side === 'normal' ? 'normal' : 'hard',
    adult: !!s.adult,
  };
}
const cleanName = (n) => String(n || '').trim().slice(0, 16) || '생존자';

io.on('connection', (socket) => {
  const err = (m) => socket.emit('toast', { error: true, text: m });

  function attach(room, seat) {
    socket.data.code = room.code; socket.data.seat = seat;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, token: room.seats[seat].token, seat });
    broadcast(room);
  }

  socket.on('room.create', ({ name, settings } = {}) => {
    const room = { code: newCode(), seats: [{ name: cleanName(name), token: token() }, null], settings: sanitizeSettings(settings), game: null, undo: [], updated: Date.now() };
    rooms.set(room.code, room);
    attach(room, 0);
  });

  socket.on('room.join', ({ code, name } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return err('방을 찾을 수 없습니다. 코드를 확인하세요.');
    const seat = room.seats.findIndex((s) => !s);
    if (seat < 0) return err('이미 2명이 모두 들어와 있습니다. 같은 기기라면 "다시 접속"을 이용하세요.');
    room.seats[seat] = { name: cleanName(name), token: token() };
    attach(room, seat);
  });

  socket.on('room.resume', ({ code, token: tok } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return socket.emit('resume.fail');
    const seat = seatOf(room, tok);
    if (seat < 0) return socket.emit('resume.fail');
    attach(room, seat);
  });

  socket.on('room.leave', () => {
    const room = rooms.get(socket.data.code);
    socket.leave(socket.data.code);
    socket.data.code = null; socket.data.seat = null;
    if (room) broadcast(room);
  });

  socket.on('room.settings', (settings) => {
    const room = rooms.get(socket.data.code); if (!room) return;
    if (room.game && room.game.phase !== 'ended') return err('게임 중에는 설정을 바꿀 수 없습니다.');
    room.settings = sanitizeSettings(settings);
    broadcast(room);
  });

  socket.on('game.start', () => {
    const room = rooms.get(socket.data.code); if (!room) return;
    if (room.seats.some((s) => !s)) return err('두 명이 모두 들어와야 시작할 수 있습니다.');
    if (room.game && room.game.phase !== 'ended' && room.game.phase !== 'setup') return err('이미 게임이 진행 중입니다.');
    room.game = G.newGame(room.settings);
    G.setupGame(room.game);
    room.undo = [];
    broadcast(room);
  });

  socket.on('game.abandon', () => {
    const room = rooms.get(socket.data.code); if (!room || !room.game) return;
    room.game = null; room.undo = [];
    broadcast(room);
  });

  socket.on('act', ({ type, payload } = {}) => {
    const room = rooms.get(socket.data.code);
    if (!room || !room.game) return err('진행 중인 게임이 없습니다.');
    const seat = socket.data.seat;
    const snapshot = JSON.stringify(room.game);
    try {
      G.apply(room.game, seat, type, payload);
    } catch (e) {
      room.game = JSON.parse(snapshot);
      if (e instanceof G.GameError) return err(e.message);
      console.error(e);
      return err('처리 중 오류가 발생했습니다: ' + e.message);
    }
    if (!['dice.use', 'chat', 'hand.reveal'].includes(type)) {
      room.undo.push(snapshot);
      if (room.undo.length > UNDO_LIMIT) room.undo.shift();
    }
    annotatePredictions(room);
    exportRealGame(room);
    broadcast(room);
  });

  socket.on('undo', () => {
    const room = rooms.get(socket.data.code);
    if (!room || !room.undo.length) return err('되돌릴 것이 없습니다.');
    room.game = JSON.parse(room.undo.pop());
    room.game.log.push({ t: Date.now(), text: `↶ P${socket.data.seat + 1}이(가) 마지막 행동을 되돌렸습니다.` });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (room) setTimeout(() => broadcast(room), 100);
  });
});

server.listen(PORT, () => console.log(`Dead of Winter 보드 도우미 실행 중: http://localhost:${PORT}`));

function shutdown() {
  try { fs.mkdirSync(SAVE_DIR, { recursive: true }); fs.writeFileSync(SAVE_FILE, JSON.stringify([...rooms.values()])); } catch (e) {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
