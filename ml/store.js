'use strict';
// 저장소: 로컬 폴더 또는 S3 호환 버킷(Lightsail 버킷)을 같은 방식으로 쓴다.
//   DOW_STORE=/경로/폴더          → 로컬
//   DOW_STORE=s3://버킷이름/접두사  → S3 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION 필요)
// 키 구조: datasets/real/date=YYYY-MM-DD/<id>.jsonl, models/<task>/<version>.json, registry.json, reports/...

const fs = require('fs');
const path = require('path');

function localStore(root) {
  const abs = (k) => path.join(root, ...k.split('/'));
  return {
    kind: 'local',
    async get(key) { try { return await fs.promises.readFile(abs(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    async put(key, body) {
      const p = abs(key); await fs.promises.mkdir(path.dirname(p), { recursive: true });
      const tmp = p + '.tmp-' + process.pid; await fs.promises.writeFile(tmp, body); await fs.promises.rename(tmp, p); // 원자적 교체
    },
    async list(prefix) {
      const base = abs(prefix); const out = [];
      async function walk(d) {
        let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (!e.name.includes('.tmp-')) out.push(path.relative(root, p).split(path.sep).join('/')); }
      }
      await walk(base); return out.sort();
    },
  };
}

function s3Store(url) {
  const m = url.match(/^s3:\/\/([^/]+)\/?(.*)$/);
  const bucket = m[1]; const prefix = m[2] ? m[2].replace(/\/?$/, '/') : '';
  const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-2', ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) });
  return {
    kind: 's3',
    async get(key) {
      try { const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + key })); return Buffer.from(await r.Body.transformToByteArray()); } catch (e) { if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null; throw e; }
    },
    async put(key, body) { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + key, Body: body })); },
    async list(p) {
      const out = []; let token;
      do { const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix + p, ContinuationToken: token })); for (const o of r.Contents || []) out.push(o.Key.slice(prefix.length)); token = r.IsTruncated ? r.NextContinuationToken : undefined; } while (token);
      return out.sort();
    },
  };
}

function openStore(spec) {
  return spec && spec.startsWith('s3://') ? s3Store(spec) : localStore(path.resolve(spec));
}

// 끝난 실제 게임의 라운드별 학습 행을 datasets/real/date=<오늘>/<게임id>.jsonl 로 올린다 (서버·시연 공용). 올린 키를 돌려준다.
async function putRealGame(store, g, rows) {
  const key = `datasets/real/date=${new Date().toISOString().slice(0, 10)}/${g.id}.jsonl`;
  await store.put(key, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return key;
}

module.exports = { openStore, putRealGame };
