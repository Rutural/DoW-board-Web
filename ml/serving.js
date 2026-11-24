'use strict';
// 모델 서빙: 레지스트리의 active 모델(JSON 가중치)을 불러와 확률을 계산한다.
// 학습(Python)과 같은 식: p = sigmoid(b + Σ w_i · (x_i − mean_i) / scale_i)
const FEAT = require('./features');

const TASKS = ['y_crisis', 'y_collapse'];

function predict(model, x) {
  let z = model.intercept;
  for (let i = 0; i < model.coef.length; i++) z += model.coef[i] * ((x[i] - model.mean[i]) / model.scale[i]);
  return 1 / (1 + Math.exp(-z));
}

// 특징값 정의가 다른 모델은 쓰지 않는다 (training/serving skew 방지)
function compatible(model) {
  if (!model || model.format !== 'dow-logreg-v1') return '모델 형식이 다름';
  if (model.schema !== FEAT.SCHEMA_VERSION) return `특징 스키마 불일치 (모델 ${model.schema}, 서버 ${FEAT.SCHEMA_VERSION})`;
  if (model.feature_names.length !== FEAT.FEATURE_NAMES.length || model.feature_names.some((n, i) => n !== FEAT.FEATURE_NAMES[i])) return '특징 이름·순서 불일치';
  return null;
}

// 레지스트리를 주기적으로 읽어 active 모델이 바뀌면 교체 (모델 배포는 코드 배포와 분리)
function createModelServer(store, { pollSeconds = 60, log = console.log } = {}) {
  const state = { models: {}, lastCheck: null, lastError: null };

  async function refresh() {
    state.lastCheck = new Date().toISOString();
    try {
      const raw = await store.get('registry.json');
      if (!raw) { state.models = {}; return; }
      const reg = JSON.parse(raw.toString('utf8'));
      const next = {};
      for (const task of TASKS) {
        const ver = reg.tasks && reg.tasks[task] && reg.tasks[task].active;
        if (!ver) continue;
        if (state.models[task] && state.models[task].version === ver) { next[task] = state.models[task]; continue; }
        const meta = reg.models[ver];
        const art = await store.get(meta.artifact);
        if (!art) { log(`⚠ 모델 파일 없음: ${meta.artifact}`); continue; }
        const model = JSON.parse(art.toString('utf8'));
        const bad = compatible(model);
        if (bad) { log(`⚠ ${ver} 사용 안 함: ${bad}`); if (state.models[task]) next[task] = state.models[task]; continue; }
        next[task] = model;
        log(`모델 적용: ${task} → ${ver}${state.models[task] ? ` (이전 ${state.models[task].version})` : ''}`);
      }
      state.models = next;
      state.lastError = null;
    } catch (e) { state.lastError = String(e.message || e); log('모델 레지스트리 읽기 실패: ' + state.lastError); }
  }

  return {
    state,
    refresh,
    start() { refresh(); if (pollSeconds > 0) setInterval(refresh, pollSeconds * 1000).unref(); },
    // x(특징값 벡터) → { y_crisis: {p, version}, ... }
    predictAll(x) {
      const out = {};
      for (const [task, m] of Object.entries(state.models)) out[task] = { p: +predict(m, x).toFixed(6), version: m.version };
      return out;
    },
    info() { return { tasks: Object.fromEntries(Object.entries(state.models).map(([t, m]) => [t, { version: m.version, trained_at: m.trained_at, metrics: m.metrics }])), last_check: state.lastCheck, last_error: state.lastError, store: store.kind }; },
  };
}

module.exports = { predict, compatible, createModelServer };
