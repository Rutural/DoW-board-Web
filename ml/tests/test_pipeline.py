"""파이프라인 전체: 첫 학습 승격 → 노이즈 라벨 차단 → 롤백 → 서빙 parity."""
import json
from ml.pipeline import registry as REG
from ml.pipeline.run import main
from ml.pipeline.store import LocalStore


def test_end_to_end(tmp_path):
    store = str(tmp_path)
    assert main(['--store', store, '--games', '800', '--seed', '1']) == 0
    reg = REG.load(LocalStore(store))
    v1 = {t: REG.active(reg, t) for t in ('y_crisis', 'y_collapse')}
    assert all(v1.values()), '첫 모델 승격'
    assert main(['--store', store, '--games', '800', '--seed', '2', '--label-noise', '0.45']) == 0
    reg = REG.load(LocalStore(store))
    assert {t: REG.active(reg, t) for t in v1} == v1, '오염된 모델은 차단되고 운영 모델 유지'
    assert sum(m['status'] == 'rejected' for m in reg['models'].values()) == 2
    rep = json.loads(LocalStore(store).get('reports/latest.json'))
    assert all(not rep['tasks'][t]['promoted'] for t in v1)
    assert all(any(c['check'] == 'parity' and c['ok'] for c in rep['tasks'][t]['checks']) for t in v1)
