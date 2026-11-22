"""데이터 적재·분할·검증."""
from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
EVAL_SIM_KEY = 'eval/sim-v1'          # 고정 검증 세트 (한 번 만들면 다시 쓰지 않음)
EVAL_SIM_SEED, EVAL_SIM_GAMES = 90001, 3000


@dataclass
class Dataset:
    name: str
    rows: list[dict]
    meta: dict = field(default_factory=dict)

    def arrays(self, task: str):
        keep = [r for r in self.rows if r.get(task) is not None]
        X = np.array([r['x'] for r in keep], dtype=float)
        y = np.array([r[task] for r in keep], dtype=int)
        return X, y, keep

    def sha(self) -> str:
        h = hashlib.sha256()
        for r in self.rows:
            h.update(json.dumps(r, sort_keys=True, ensure_ascii=False).encode())
        return h.hexdigest()[:12]


def parse_jsonl(b: bytes) -> list[dict]:
    return [json.loads(l) for l in b.decode('utf-8').splitlines() if l.strip()]


def simulate(games: int, seed: int, *, hard: float | None = None, skill: float | None = None) -> tuple[list[dict], dict]:
    """엔진(Node)으로 봇 시뮬레이션을 돌려 행과 매니페스트를 받는다."""
    with tempfile.TemporaryDirectory() as tmp:
        cmd = ['node', str(ROOT / 'ml' / 'simulate.js'), '--games', str(games), '--seed', str(seed), '--out', tmp]
        if hard is not None:
            cmd += ['--hard', str(hard)]
        if skill is not None:
            cmd += ['--skill', str(skill)]
        subprocess.run(cmd, check=True, capture_output=True)
        run_dir = next(Path(tmp).iterdir())
        rows = parse_jsonl((run_dir / 'rows.jsonl').read_bytes())
        manifest = json.loads((run_dir / 'manifest.json').read_text(encoding='utf-8'))
    return rows, manifest


def put_dataset(store, key: str, rows: list[dict], manifest: dict) -> None:
    store.put(f'{key}/rows.jsonl', ('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n').encode())
    store.put(f'{key}/manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())


def load_or_create_eval_sim(store, log=print) -> Dataset:
    raw = store.get(f'{EVAL_SIM_KEY}/rows.jsonl')
    if raw is None:
        log(f'고정 검증 세트가 없어 새로 만듭니다: {EVAL_SIM_KEY} (seed {EVAL_SIM_SEED}, {EVAL_SIM_GAMES}판)')
        rows, manifest = simulate(EVAL_SIM_GAMES, EVAL_SIM_SEED)
        manifest['frozen'] = True
        put_dataset(store, EVAL_SIM_KEY, rows, manifest)
        return Dataset('eval_sim', rows, manifest)
    manifest = json.loads(store.get(f'{EVAL_SIM_KEY}/manifest.json'))
    return Dataset('eval_sim', parse_jsonl(raw), manifest)


def is_eval_game(game_id: str) -> bool:
    """실제 게임은 게임 id 해시로 20%를 검증용으로 고정 배정 (매번 같은 판이 같은 쪽으로)."""
    return int(hashlib.md5(game_id.encode()).hexdigest(), 16) % 5 == 0


def load_real(store) -> tuple[Dataset, Dataset]:
    train, ev = [], []
    for key in store.list('datasets/real/'):
        if not key.endswith('.jsonl'):
            continue
        for r in parse_jsonl(store.get(key)):
            (ev if is_eval_game(r['game_id']) else train).append(r)
    return Dataset('real_train', train), Dataset('real_eval', ev)


# ───── 검증 ─────

class DataCheckError(Exception):
    pass


def validate(ds: Dataset, *, schema: int, n_features: int, tasks: list[str], min_rows: int, require_both_classes: bool = True) -> list[str]:
    """문제가 있으면 DataCheckError. 경고는 목록으로 돌려준다."""
    warns = []
    if len(ds.rows) < min_rows:
        raise DataCheckError(f'{ds.name}: 행이 너무 적음 ({len(ds.rows)} < {min_rows})')
    bad_schema = {r.get('schema') for r in ds.rows} - {schema}
    if bad_schema:
        raise DataCheckError(f'{ds.name}: 스키마 버전 불일치 {bad_schema} (기대 {schema})')
    lens = {len(r['x']) for r in ds.rows}
    if lens != {n_features}:
        raise DataCheckError(f'{ds.name}: 특징값 개수 불일치 {lens} (기대 {n_features})')
    X = np.array([r['x'] for r in ds.rows], dtype=float)
    if not np.isfinite(X).all():
        raise DataCheckError(f'{ds.name}: NaN/무한대 값 포함')
    for t in tasks:
        y = [r[t] for r in ds.rows if r.get(t) is not None]
        pos = sum(y) / max(1, len(y))
        if require_both_classes and (pos == 0 or pos == 1):
            raise DataCheckError(f'{ds.name}: {t} 라벨이 한쪽만 있음 (양성 비율 {pos:.2f})')
        if pos < 0.05 or pos > 0.95:
            warns.append(f'{ds.name}: {t} 라벨이 심하게 치우침 (양성 비율 {pos:.2f})')
    const = np.where(X.std(axis=0) == 0)[0]
    if len(const):
        warns.append(f'{ds.name}: 값이 변하지 않는 특징 {len(const)}개')
    return warns
