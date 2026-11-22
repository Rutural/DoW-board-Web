"""레지스트리: 승격은 한 번에(active가 항상 1개), 차단은 사유와 함께, 롤백은 직전 archived로."""
import json
import pytest
from ml.pipeline import registry as REG
from ml.pipeline.store import LocalStore


def art(task, ver):
    return {'format': 'dow-logreg-v1', 'task': task, 'version': ver, 'schema': 1, 'feature_names': [], 'mean': [], 'scale': [], 'coef': [], 'intercept': 0}


def actives(reg, task):
    return [v for v, m in reg['models'].items() if m['task'] == task and m['status'] == 'active']


def test_promote_reject_rollback(tmp_path):
    st = LocalStore(tmp_path)
    reg = REG.load(st)
    reg = REG.register(st, reg, art('t', 'v1'), promote=True, reasons=[], record={})
    reg = REG.register(st, reg, art('t', 'v2'), promote=True, reasons=[], record={})
    assert REG.active(reg, 't') == 'v2' and reg['models']['v1']['status'] == 'archived'
    assert actives(reg, 't') == ['v2']

    reg = REG.register(st, reg, art('t', 'v3'), promote=False, reasons=['AUC 유지: 하락'], record={})
    assert REG.active(reg, 't') == 'v2'
    assert reg['models']['v3']['status'] == 'rejected' and reg['models']['v3']['reasons'] == ['AUC 유지: 하락']
    assert st.get('models/t/v3.json') is not None, '차단된 모델도 분석용으로 보관'

    cur, to = REG.rollback(st, 't')
    reg = REG.load(st)
    assert (cur, to) == ('v2', 'v1') and REG.active(reg, 't') == 'v1'
    assert reg['models']['v2']['status'] == 'rolled_back'
    assert actives(reg, 't') == ['v1']
    assert [e['action'] for e in reg['events']] == ['promote', 'promote', 'reject', 'rollback']


def test_cannot_rollback_to_rejected_or_without_history(tmp_path):
    st = LocalStore(tmp_path)
    reg = REG.register(st, REG.load(st), art('t', 'v1'), promote=True, reasons=[], record={})
    with pytest.raises(SystemExit):
        REG.rollback(st, 't')                                   # 이전 모델 없음
    reg = REG.register(st, reg, art('t', 'bad'), promote=False, reasons=['x'], record={})
    with pytest.raises(SystemExit):
        REG.rollback(st, 't', to='bad')                         # 차단된 모델로는 못 감


def test_registry_file_is_replaced_atomically(tmp_path):
    st = LocalStore(tmp_path)
    REG.register(st, REG.load(st), art('t', 'v1'), promote=True, reasons=[], record={})
    assert not list(tmp_path.glob('*.tmp-*')), '임시 파일이 남지 않음'
    json.loads((tmp_path / 'registry.json').read_text())
