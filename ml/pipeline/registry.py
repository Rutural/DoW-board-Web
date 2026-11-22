"""모델 레지스트리 (registry.json 하나 + models/<task>/<version>.json).

상태: active(운영 중) / archived(이전 운영) / rejected(게이트 차단) / rolled_back(롤백으로 내려감)
레지스트리 갱신은 항상 파일 하나를 통째로 교체 → 승격 중간에 active가 0개나 2개가 되지 않는다.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

now = lambda: datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load(store) -> dict:
    raw = store.get('registry.json')
    if raw is None:
        return {'schema': 1, 'tasks': {}, 'models': {}, 'events': []}
    return json.loads(raw)


def save(store, reg: dict) -> None:
    reg['updated_at'] = now()
    store.put('registry.json', json.dumps(reg, ensure_ascii=False, indent=2).encode())


def active(reg: dict, task: str) -> str | None:
    return reg['tasks'].get(task, {}).get('active')


def load_artifact(store, reg: dict, version: str) -> dict:
    return json.loads(store.get(reg['models'][version]['artifact']))


def register(store, reg: dict, art: dict, *, promote: bool, reasons: list[str], record: dict) -> dict:
    """모델 파일을 먼저 올리고, 레지스트리를 한 번에 갱신한다."""
    task, ver = art['task'], art['version']
    key = f'models/{task}/{ver}.json'
    store.put(key, json.dumps(art, ensure_ascii=False).encode())
    t = reg['tasks'].setdefault(task, {'active': None, 'history': []})
    prev = t['active']
    reg['models'][ver] = {**record, 'task': task, 'artifact': key, 'created_at': now(),
                          'status': 'active' if promote else 'rejected', 'reasons': reasons, 'replaced': prev if promote else None}
    if promote:
        if prev:
            reg['models'][prev]['status'] = 'archived'
        t['active'] = ver
        t['history'].append(ver)
        reg['events'].append({'at': now(), 'task': task, 'action': 'promote', 'version': ver, 'previous': prev})
    else:
        reg['events'].append({'at': now(), 'task': task, 'action': 'reject', 'version': ver, 'reasons': reasons})
    save(store, reg)
    return reg


def rollback(store, task: str, to: str | None = None, reason: str = '수동 롤백') -> tuple[str, str]:
    reg = load(store)
    t = reg['tasks'].get(task)
    if not t or not t['active']:
        raise SystemExit(f'{task}: 운영 중인 모델이 없습니다.')
    cur = t['active']
    if to is None:
        hist = [v for v in t['history'] if v != cur and reg['models'][v]['status'] == 'archived']
        if not hist:
            raise SystemExit(f'{task}: 되돌릴 이전 모델이 없습니다.')
        to = hist[-1]
    if to not in reg['models'] or reg['models'][to]['task'] != task or reg['models'][to]['status'] == 'rejected':
        raise SystemExit(f'{to}: 되돌릴 수 없는 모델입니다 (없거나 게이트에서 차단된 모델).')
    reg['models'][cur]['status'] = 'rolled_back'
    reg['models'][to]['status'] = 'active'
    t['active'] = to
    t['history'].append(to)
    reg['events'].append({'at': now(), 'task': task, 'action': 'rollback', 'version': to, 'previous': cur, 'reason': reason})
    save(store, reg)
    return cur, to


def main(argv=None):
    from ml.pipeline.store import open_store
    ap = argparse.ArgumentParser(description='모델 레지스트리')
    ap.add_argument('--store', required=True)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('show')
    r = sub.add_parser('rollback'); r.add_argument('--task', required=True); r.add_argument('--to'); r.add_argument('--reason', default='수동 롤백')
    a = ap.parse_args(argv)
    store = open_store(a.store)
    if a.cmd == 'show':
        reg = load(store)
        for task, t in reg['tasks'].items():
            print(f"[{task}] 운영 중: {t['active']}")
            for v in list(dict.fromkeys(reversed(t['history'])))[:5][::-1]:
                m = reg['models'][v]
                print(f"   {v}  {m['status']:<11} AUC {m.get('metrics', {}).get('auc')}")
        rej = [v for v, m in reg['models'].items() if m['status'] == 'rejected']
        if rej:
            print(f'차단된 모델 {len(rej)}개 — 최근: {rej[-1]} ({"; ".join(reg["models"][rej[-1]]["reasons"])})')
        for e in reg['events'][-6:]:
            print('  ', e['at'], e['task'], e['action'], e['version'])
    else:
        cur, to = rollback(store, a.task, a.to, a.reason)
        print(f'{a.task}: {cur} → {to} 롤백 완료 (서버는 다음 확인 주기에 자동 적용)')


if __name__ == '__main__':
    sys.exit(main())
