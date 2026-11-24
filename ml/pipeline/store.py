"""저장소: 로컬 폴더 또는 S3 호환 버킷(Lightsail 버킷). Node 쪽 ml/store.js와 같은 키 구조를 쓴다."""
from __future__ import annotations

import os
from pathlib import Path


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _p(self, key: str) -> Path:
        return self.root.joinpath(*key.split('/'))

    def get(self, key: str) -> bytes | None:
        p = self._p(key)
        return p.read_bytes() if p.exists() else None

    def put(self, key: str, body: bytes) -> None:
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + f'.tmp-{os.getpid()}')
        tmp.write_bytes(body)
        tmp.replace(p)  # 원자적 교체: 읽는 쪽이 반쯤 쓴 파일을 보지 않음

    def list(self, prefix: str) -> list[str]:
        base = self._p(prefix)
        if not base.exists():
            return []
        return sorted(str(p.relative_to(self.root)).replace(os.sep, '/') for p in base.rglob('*') if p.is_file() and '.tmp-' not in p.name)

    def __repr__(self):
        return f'LocalStore({self.root})'


class S3Store:
    def __init__(self, url: str):
        import boto3
        rest = url[len('s3://'):]
        self.bucket, _, prefix = rest.partition('/')
        self.prefix = (prefix.rstrip('/') + '/') if prefix else ''
        kw = {'region_name': os.environ.get('AWS_REGION', 'ap-northeast-2')}
        if os.environ.get('S3_ENDPOINT'):
            kw['endpoint_url'] = os.environ['S3_ENDPOINT']
        self.s3 = boto3.client('s3', **kw)
        self.url = url

    def get(self, key):
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=self.prefix + key)['Body'].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def put(self, key, body):
        self.s3.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=body)  # 단일 객체 덮어쓰기는 원자적

    def list(self, prefix):
        pages = self.s3.get_paginator('list_objects_v2').paginate(Bucket=self.bucket, Prefix=self.prefix + prefix)
        return sorted(o['Key'][len(self.prefix):] for page in pages for o in page.get('Contents', []))

    def __repr__(self):
        return f'S3Store({self.url})'


def open_store(spec: str):
    return S3Store(spec) if spec.startswith('s3://') else LocalStore(spec)
