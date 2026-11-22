'use strict';
// 시뮬레이션 재현성: 같은 시드 → 같은 데이터(해시), 다른 시드 → 다른 데이터
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function run(seed) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dow-sim-'));
  execFileSync(process.execPath, [path.join(__dirname, '..', 'ml', 'simulate.js'), '--games', '300', '--seed', String(seed), '--out', out], { stdio: 'pipe' });
  const dir = path.join(out, fs.readdirSync(out)[0]);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  fs.rmSync(out, { recursive: true, force: true });
  return m;
}

test('같은 시드면 같은 데이터, 다른 시드면 다른 데이터', () => {
  const a = run(11), b = run(11), c = run(12);
  assert.equal(a.files[0].sha256, b.files[0].sha256);
  assert.notEqual(a.files[0].sha256, c.files[0].sha256);
  assert.equal(a.schema, 1);
  assert.equal(a.feature_names.length, 57);
  assert.ok(a.stats.rows > 300, '판마다 1행 이상');
  // 라벨이 한쪽으로만 쏠리지 않았는지 (학습 가능한 데이터인지 최소 확인)
  assert.ok(a.stats.crisis_fail_rate > 0.1 && a.stats.crisis_fail_rate < 0.9);
});
