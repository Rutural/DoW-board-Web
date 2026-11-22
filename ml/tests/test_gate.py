"""게이트 판단 로직 (Gemini 안의 4일차 엣지 케이스 포함)."""
import numpy as np
from ml.pipeline.gate import GateConfig, decide

rng = np.random.default_rng(0)


def make(n=2000, pos=0.4):
    y = (rng.random(n) < pos).astype(int)
    good = np.clip(y * 0.6 + 0.2 + rng.normal(0, 0.12, n), 0.01, 0.99)   # 잘 맞히는 예측
    weak = np.clip(y * 0.2 + 0.4 + rng.normal(0, 0.2, n), 0.01, 0.99)    # 덜 맞히는 예측
    return y, good, weak


def test_first_model_promoted_if_beats_baseline():
    y, good, _ = make()
    d, m = decide(y, good, None)
    assert d.promote and m['active'] is None


def test_first_model_rejected_if_not_better_than_baseline():
    y, _, _ = make()
    d, _ = decide(y, np.full(len(y), y.mean()) + rng.normal(0, 0.001, len(y)), None)
    assert not d.promote and any('기준선' in r for r in d.reasons)


def test_worse_candidate_rejected_and_reasons_recorded():
    y, good, weak = make()
    d, _ = decide(y, weak, good)
    assert not d.promote
    assert any('AUC 유지' in r for r in d.reasons) and any('Brier 유지' in r for r in d.reasons)


def test_equal_or_better_candidate_promoted():
    y, good, weak = make()
    assert decide(y, good, weak)[0].promote
    assert decide(y, good, good)[0].promote   # 동등 → 허용 오차 안이므로 승격(새 데이터 반영)


def test_small_eval_set_blocks():
    y, good, weak = make(n=200)
    d, _ = decide(y, good, weak)
    assert not d.promote and any('검증 세트 크기' in r for r in d.reasons)


def test_single_class_blocks():
    y = np.ones(1000, dtype=int)
    d, _ = decide(y, np.full(1000, 0.9), None)
    assert not d.promote and any('클래스 균형' in r for r in d.reasons)


def test_slice_regression_blocks_even_if_overall_ok():
    y, good, _ = make(n=3000)
    slices = np.array(['a'] * 1500 + ['b'] * 1500)
    cand = good.copy()
    cand[1500:] = 0.5 + rng.normal(0, 0.01, 1500)            # 조각 b에서만 망가짐
    d, m = decide(y, cand, good, slices=slices, cfg=GateConfig(auc_tolerance=1, brier_tolerance=1))
    assert not d.promote and any('조각[b]' in r for r in d.reasons)
