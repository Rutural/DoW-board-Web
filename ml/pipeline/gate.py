"""평가 지표와 승격 게이트."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score


@dataclass
class GateConfig:
    min_eval_rows: int = 500          # 검증 세트 최소 행 수
    min_class_rows: int = 50          # 각 클래스 최소 행 수
    baseline_margin: float = 0.01     # 기준선(양성 비율 예측) 대비 Brier가 최소 이만큼 좋아야 함
    auc_tolerance: float = 0.005      # 운영 모델 대비 AUC 하락 허용폭
    brier_tolerance: float = 0.002    # 운영 모델 대비 Brier 상승 허용폭
    slice_min_rows: int = 150         # 공동목표별 조각 비교 최소 행 수
    slice_auc_tolerance: float = 0.03
    real_min_rows: int = 100          # 실제 게임 검증 세트가 이 이상이면 함께 비교
    real_brier_tolerance: float = 0.01


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    both = len(set(y.tolist())) == 2
    bins = np.minimum((p * 10).astype(int), 9)
    gap = np.abs(np.bincount(bins, weights=p, minlength=10) - np.bincount(bins, weights=y, minlength=10))
    ece = gap.sum() / len(y)   # Σ_b |평균p_b − 평균y_b| · n_b/n
    return {
        'n': int(len(y)), 'pos_rate': float(y.mean()),
        'auc': float(roc_auc_score(y, p)) if both else None,
        'brier': float(brier_score_loss(y, p)),
        'logloss': float(log_loss(y, p, labels=[0, 1])),
        'ece': float(ece),
    }


@dataclass
class Decision:
    reasons: list[str] = field(default_factory=list)
    checks: list[dict] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str):
        self.checks.append({'check': name, 'ok': bool(ok), 'detail': detail})
        if not ok:
            self.reasons.append(f'{name}: {detail}')

    @property
    def promote(self) -> bool:
        return not self.reasons


def decide(y: np.ndarray, p_cand: np.ndarray, p_active: np.ndarray | None, *, slices: np.ndarray | None = None,
           real: tuple[np.ndarray, np.ndarray, np.ndarray | None] | None = None, cfg: GateConfig = GateConfig()) -> tuple[Decision, dict]:
    """같은 검증 세트에서 후보와 운영 모델을 그 자리에서 다시 평가해 비교한다."""
    d = Decision()
    m = {'candidate': None, 'active': None, 'baseline': None, 'slices': {}, 'real': None}

    n_pos, n = int(y.sum()), len(y)
    d.add('검증 세트 크기', n >= cfg.min_eval_rows, f'{n}행 (최소 {cfg.min_eval_rows})')
    d.add('클래스 균형', min(n_pos, n - n_pos) >= cfg.min_class_rows, f'양성 {n_pos} / 음성 {n - n_pos} (각 최소 {cfg.min_class_rows})')
    if d.reasons:
        return d, m

    m['candidate'] = mc = metrics(y, p_cand)
    m['baseline'] = mb = metrics(y, np.full(n, y.mean()))
    d.add('기준선보다 나음', mc['brier'] <= mb['brier'] - cfg.baseline_margin, f"Brier {mc['brier']:.4f} vs 기준선 {mb['brier']:.4f}")

    if p_active is not None:
        m['active'] = ma = metrics(y, p_active)
        d.add('AUC 유지', mc['auc'] >= ma['auc'] - cfg.auc_tolerance, f"후보 {mc['auc']:.4f} vs 운영 {ma['auc']:.4f} (허용 −{cfg.auc_tolerance})")
        d.add('Brier 유지', mc['brier'] <= ma['brier'] + cfg.brier_tolerance, f"후보 {mc['brier']:.4f} vs 운영 {ma['brier']:.4f} (허용 +{cfg.brier_tolerance})")
        if slices is not None:
            for s in sorted(set(slices.tolist())):
                k = slices == s
                if k.sum() < cfg.slice_min_rows or len(set(y[k].tolist())) < 2:
                    continue
                sc, sa = metrics(y[k], p_cand[k]), metrics(y[k], p_active[k])
                m['slices'][s] = {'candidate_auc': sc['auc'], 'active_auc': sa['auc'], 'n': int(k.sum())}
                d.add(f'조각[{s}] AUC', sc['auc'] >= sa['auc'] - cfg.slice_auc_tolerance, f"후보 {sc['auc']:.3f} vs 운영 {sa['auc']:.3f}")
    else:
        d.add('운영 모델', True, '없음 (첫 모델은 기준선·크기 조건만 확인)')

    if real is not None:
        yr, pr_c, pr_a = real
        if len(yr) >= cfg.real_min_rows and len(set(yr.tolist())) == 2:
            rc = metrics(yr, pr_c)
            m['real'] = {'candidate': rc, 'active': metrics(yr, pr_a) if pr_a is not None else None}
            if pr_a is not None:
                ra = m['real']['active']
                d.add('실제 게임 Brier 유지', rc['brier'] <= ra['brier'] + cfg.real_brier_tolerance, f"후보 {rc['brier']:.4f} vs 운영 {ra['brier']:.4f}")
        else:
            d.add('실제 게임 비교', True, f'건너뜀 (실제 검증 데이터 {len(yr)}행, 최소 {cfg.real_min_rows})')

    return d, m
