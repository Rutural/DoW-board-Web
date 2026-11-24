"""모델 학습·내보내기·예측. 서빙(Node)과 같은 식을 쓸 수 있도록 로지스틱 회귀 + 표준화만 사용한다."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FORMAT = 'dow-logreg-v1'


def train(X: np.ndarray, y: np.ndarray, sample_weight: np.ndarray | None = None) -> Pipeline:
    pipe = Pipeline([('scale', StandardScaler()), ('lr', LogisticRegression(max_iter=5000))])
    pipe.fit(X, y, lr__sample_weight=sample_weight)
    return pipe


def export(pipe: Pipeline, *, task: str, version: str, schema: int, feature_names: list[str], meta: dict) -> dict:
    sc, lr = pipe.named_steps['scale'], pipe.named_steps['lr']
    return {
        'format': FORMAT, 'task': task, 'version': version, 'schema': schema,
        'feature_names': list(feature_names),
        'mean': [float(v) for v in sc.mean_],
        'scale': [float(v) for v in sc.scale_],
        'coef': [float(v) for v in lr.coef_[0]],
        'intercept': float(lr.intercept_[0]),
        **meta,
    }


def predict_artifact(art: dict, X: np.ndarray) -> np.ndarray:
    """내보낸 JSON만으로 계산 (서빙과 같은 식). 레지스트리의 기존 모델 평가에도 쓴다."""
    z = art['intercept'] + ((X - np.array(art['mean'])) / np.array(art['scale'])) @ np.array(art['coef'])
    return 1.0 / (1.0 + np.exp(-z))
