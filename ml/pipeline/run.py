"""학습 파이프라인 한 번 실행: 데이터 → 검증 → 학습 → 게이트 → parity → 레지스트리 → 모니터링 리포트.

사용법:
  python -m ml.pipeline.run --store saves/store                 # 로컬 저장소
  python -m ml.pipeline.run --store s3://버킷/dow                 # Lightsail 버킷
  옵션: --games 3000 --seed <정수> --label-noise 0.4(시연: 일부러 라벨 오염) --hard 1.0 --skill 1.0(시연: 분포 이동)
종료 코드: 0 정상(승격이든 차단이든 판단 완료) / 2 데이터 검증 실패 / 3 parity 실패
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ml.pipeline import data as D
from ml.pipeline import model as M
from ml.pipeline import registry as REG
from ml.pipeline.gate import decide
from ml.pipeline.monitor import drift, live_performance
from ml.pipeline.store import open_store

TASKS = ['y_crisis', 'y_collapse']
ROOT = Path(__file__).resolve().parents[2]
REAL_WEIGHT = 3.0   # 실제 게임 한 행을 시뮬레이션 몇 행만큼 쳐줄지


def git_sha() -> str:
    try:
        return subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return 'local'


def parity(art: dict, X: np.ndarray, p_py: np.ndarray, tol: float = 1e-9) -> tuple[bool, float]:
    """학습(Python)과 서빙(Node)이 같은 입력에 같은 확률을 내는지 확인."""
    with tempfile.TemporaryDirectory() as tmp:
        mp, xp = Path(tmp) / 'm.json', Path(tmp) / 'x.json'
        mp.write_text(json.dumps(art)); xp.write_text(json.dumps(X.tolist()))
        r = subprocess.run(['node', str(ROOT / 'ml' / 'parity_check.js'), str(mp), str(xp)], capture_output=True, text=True)
        if r.returncode != 0:
            return False, float('inf')
        p_node = np.array(json.loads(r.stdout))
    diff = float(np.max(np.abs(p_node - p_py)))
    return diff <= tol, diff


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--store', default=os.environ.get('DOW_STORE', str(ROOT / 'saves' / 'store')))
    ap.add_argument('--games', type=int, default=3000)
    ap.add_argument('--seed', type=int, default=None)
    ap.add_argument('--label-noise', type=float, default=0.0)
    ap.add_argument('--hard', type=float, default=None)
    ap.add_argument('--skill', type=float, default=None)
    a = ap.parse_args(argv)

    store = open_store(a.store)
    started = datetime.now(timezone.utc)
    run_id = started.strftime('%Y%m%dT%H%M%SZ')
    seed = a.seed if a.seed is not None else int(started.timestamp()) % 1_000_000
    sha = git_sha()
    lines = []
    def log(s=''):
        print(s); lines.append(s)

    log(f'■ 학습 파이프라인 {run_id} · 저장소 {store} · 코드 {sha}')
    report = {'run_id': run_id, 'store': str(store), 'git_sha': sha, 'seed': seed, 'options': vars(a), 'tasks': {}, 'data': {}, 'warnings': []}

    # 1) 데이터
    log(f'\n① 데이터: 시뮬레이션 {a.games}판 (seed {seed})')
    sim_rows, sim_manifest = D.simulate(a.games, seed, hard=a.hard, skill=a.skill)
    feat_names, schema = sim_manifest['feature_names'], sim_manifest['schema']   # 특징 정의는 엔진(features.js)이 기준
    sim_key = f"datasets/sim/{sim_manifest['run_id']}"
    D.put_dataset(store, sim_key, sim_rows, sim_manifest)
    sim = D.Dataset('sim_train', sim_rows)
    eval_sim = D.load_or_create_eval_sim(store, log)
    real_train, real_eval = D.load_real(store)
    for ds in (sim, eval_sim, real_train, real_eval):
        report['data'][ds.name] = {'rows': len(ds.rows), 'games': len({r['game_id'] for r in ds.rows}), 'sha': ds.sha()}
        log(f'   {ds.name:<10} {len(ds.rows):>6}행  {report["data"][ds.name]["games"]:>5}판  sha {report["data"][ds.name]["sha"]}')

    # 2) 데이터 검증
    log('\n② 데이터 검증')
    try:
        for ds, mn in ((sim, 500), (eval_sim, 500)):
            report['warnings'] += D.validate(ds, schema=schema, n_features=len(feat_names), tasks=TASKS, min_rows=mn)
        if real_train.rows:
            report['warnings'] += D.validate(real_train, schema=schema, n_features=len(feat_names), tasks=TASKS, min_rows=1, require_both_classes=False)
    except D.DataCheckError as e:
        log(f'   ✖ {e} → 학습 중단')
        report['status'] = 'data_check_failed'; report['error'] = str(e)
        _write_report(store, report, lines)
        return 2
    for w in report['warnings']:
        log(f'   ⚠ {w}')
    log('   ✔ 스키마·특징 수·결측·라벨 분포 통과')

    reg = REG.load(store)
    exit_code = 0
    for task in TASKS:
        log(f'\n③ [{task}] 학습')
        X, y, _ = sim.arrays(task)
        w = np.ones(len(y))
        Xr, yr, _ = real_train.arrays(task)
        if len(yr):
            X, y, w = np.vstack([X, Xr]), np.concatenate([y, yr]), np.concatenate([w, np.full(len(yr), REAL_WEIGHT)])
        if a.label_noise > 0:
            rng = np.random.default_rng(seed)
            flip = rng.random(len(y)) < a.label_noise
            y = np.where(flip, 1 - y, y)
            log(f'   ⚠ 시연용 라벨 오염: {flip.mean():.0%} 뒤집음')
        pipe = M.train(X, y, sample_weight=w)
        version = f'{task}-{run_id}-{sha[:6]}'
        Xe, ye, ke = eval_sim.arrays(task)
        p_cand = pipe.predict_proba(Xe)[:, 1]
        act_ver = REG.active(reg, task)
        act_art = REG.load_artifact(store, reg, act_ver) if act_ver else None
        p_act = M.predict_artifact(act_art, Xe) if act_art else None
        slices = np.array([r['objective'] for r in ke])
        real = None
        Xre, yre, _ = real_eval.arrays(task)
        if len(yre):
            real = (yre, pipe.predict_proba(Xre)[:, 1], M.predict_artifact(act_art, Xre) if act_art else None)

        log(f'④ [{task}] 게이트 (고정 검증 세트에서 후보 vs 운영 {act_ver or "없음"})')
        dec, mets = decide(ye, p_cand, p_act, slices=slices, real=real)

        art = M.export(pipe, task=task, version=version, schema=schema, feature_names=feat_names, meta={
            'trained_at': started.isoformat(), 'git_sha': sha, 'seed': seed,
            'data': report['data'], 'metrics': mets['candidate'],
            'options': {'label_noise': a.label_noise, 'hard': a.hard, 'skill': a.skill},
        })

        log(f'⑤ [{task}] parity (Python 학습 vs Node 서빙, 검증 세트 500행)')
        ok, diff = parity(art, Xe[:500], p_cand[:500])
        dec.add('parity', ok, f'최대 차이 {diff:.2e} (허용 1e-9)')   # 실패하면 사유가 추가되어 승격 차단
        if not ok:
            exit_code = 3

        for c in dec.checks:
            log(f"   {'✔' if c['ok'] else '✖'} {c['check']}: {c['detail']}")
        reg = REG.register(store, reg, art, promote=dec.promote, reasons=dec.reasons,
                           record={'metrics': mets['candidate'], 'active_metrics_same_eval': mets['active'], 'baseline': mets['baseline'], 'gate_checks': dec.checks, 'git_sha': sha, 'seed': seed})
        log(f"   → {'✅ 승격' if dec.promote else '⛔ 차단'}: {version}" + ('' if dec.promote else f" (운영 유지: {act_ver})"))
        report['tasks'][task] = {'version': version, 'promoted': dec.promote, 'reasons': dec.reasons, 'checks': dec.checks, 'metrics': mets, 'active_before': act_ver, 'active_after': REG.active(reg, task)}

    # 6) 모니터링
    log('\n⑥ 모니터링')
    real_all = real_train.rows + real_eval.rows
    real_X = np.array([r['x'] for r in real_all], dtype=float) if real_all else np.zeros((0, len(feat_names)))
    sim_X = np.array([r['x'] for r in sim.rows], dtype=float)
    report['monitoring'] = {'drift': drift(sim_X, real_X, feat_names), 'live': live_performance(real_all, TASKS)}
    dr = report['monitoring']['drift']
    log(f"   분포 차이(PSI): {dr['status']}" + (f" — 상위 {', '.join(t['feature'] + '=' + str(t['psi']) for t in dr['top'][:4])}" if dr.get('top') else f" — {dr.get('detail', '')}"))
    for t, v in report['monitoring']['live'].items():
        log(f"   실제 성능 [{t}]: {v['status']}" + (f" — AUC {v['auc']}, Brier {v['brier']:.3f}, 보정오차 {v['ece']:.3f}" if v['status'] != 'skipped' else f" — {v['detail']}"))

    report['status'] = 'ok' if exit_code == 0 else 'parity_failed'
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    _write_report(store, report, lines)
    log(f'\n리포트: reports/{run_id}.json')
    return exit_code


def _write_report(store, report, lines):
    body = json.dumps(report, ensure_ascii=False, indent=2, default=str).encode()
    store.put(f"reports/{report['run_id']}.json", body)
    store.put(f"reports/{report['run_id']}.txt", '\n'.join(lines).encode())
    store.put('reports/latest.json', body)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write('```\n' + '\n'.join(lines) + '\n```\n')


if __name__ == '__main__':
    sys.exit(main())
