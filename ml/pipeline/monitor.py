"""모니터링: 시뮬레이션(학습) 분포와 실제 게임 분포의 차이(PSI), 실제 게임에서의 예측 성능."""
from __future__ import annotations

import numpy as np

from ml.pipeline.gate import metrics


def psi(a: np.ndarray, b: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index: 0.1 미만 안정, 0.1~0.25 주의, 0.25 이상 큰 변화."""
    qs = np.unique(np.quantile(a, np.linspace(0, 1, bins + 1)))
    if len(qs) < 3:
        qs = np.unique(np.concatenate([[a.min() - 1e-9], [a.min(), a.max()], [a.max() + 1e-9]]))
    ea = np.histogram(a, qs)[0] / len(a) + 1e-4
    eb = np.histogram(np.clip(b, qs[0], qs[-1]), qs)[0] / max(1, len(b)) + 1e-4
    return float(np.sum((eb - ea) * np.log(eb / ea)))


def drift(train_X: np.ndarray, real_X: np.ndarray, names: list[str], min_rows: int = 30) -> dict:
    if len(real_X) < min_rows:
        return {'status': 'skipped', 'detail': f'실제 게임 데이터 부족 ({len(real_X)}행, 최소 {min_rows})'}
    scores = {n: psi(train_X[:, i], real_X[:, i]) for i, n in enumerate(names)}
    top = sorted(scores.items(), key=lambda kv: -kv[1])[:8]
    alert = [n for n, v in scores.items() if v >= 0.25]
    return {'status': 'alert' if alert else 'ok', 'rows': int(len(real_X)), 'top': [{'feature': n, 'psi': round(v, 4)} for n, v in top], 'alert_features': alert}


def live_performance(real_rows: list[dict], tasks: list[str]) -> dict:
    """서버가 라운드마다 남긴 예측(pred)과 실제 결과를 비교 — 운영 중 모델이 실제로 맞고 있는가."""
    out = {}
    for t in tasks:
        pairs = [(r[t], r['pred'][t]['p'], r['pred'][t]['version']) for r in real_rows
                 if r.get(t) is not None and r.get('pred') and t in r['pred']]
        if len(pairs) < 20:
            out[t] = {'status': 'skipped', 'detail': f'예측이 기록된 실제 라운드 {len(pairs)}개 (최소 20)'}
            continue
        y = np.array([a for a, _, _ in pairs]); p = np.array([b for _, b, _ in pairs])
        m = metrics(y, p)
        out[t] = {'status': 'alert' if m['ece'] > 0.15 else 'ok', **m, 'versions': sorted({v for _, _, v in pairs})}
    return out
