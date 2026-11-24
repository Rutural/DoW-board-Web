"""데이터 검증과 실제 게임 분할."""
import pytest
from ml.pipeline.data import Dataset, DataCheckError, is_eval_game, validate

def rows(n, y=None, x_len=3, schema=1, nan_at=None):
    r = [{'schema': schema, 'game_id': f'g{i}', 'x': [i, 1.0, i % 3][:x_len] + [0.0] * (x_len - 3), 'y_a': (i % 2 if y is None else y)} for i in range(n)]
    if nan_at is not None:
        r[nan_at]['x'][0] = float('nan')
    return r

def test_ok():
    assert isinstance(validate(Dataset('d', rows(100)), schema=1, n_features=3, tasks=['y_a'], min_rows=10), list)

@pytest.mark.parametrize('ds,msg', [
    (Dataset('d', rows(5)), '행이 너무 적음'),
    (Dataset('d', rows(100, schema=2)), '스키마'),
    (Dataset('d', rows(100, x_len=4)), '특징값 개수'),
    (Dataset('d', rows(100, y=1)), '한쪽만'),
    (Dataset('d', rows(100, nan_at=3)), 'NaN'),
])
def test_rejects(ds, msg):
    with pytest.raises(DataCheckError, match=msg):
        validate(ds, schema=1, n_features=3, tasks=['y_a'], min_rows=10)

def test_real_game_split_is_stable_and_about_20pct():
    ids = [f'game-{i}' for i in range(2000)]
    first = [is_eval_game(g) for g in ids]
    assert first == [is_eval_game(g) for g in ids]
    assert 0.15 < sum(first) / len(ids) < 0.25
