#!/usr/bin/env node
'use strict';
// parity 검사용: Node 서빙 코드로 확률을 계산해 출력한다.
// 사용법: node ml/parity_check.js <model.json> <x.json(2차원 배열)>  → stdout에 확률 배열(JSON)
const fs = require('fs');
const { predict, compatible } = require('./serving');
const model = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const X = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const bad = compatible(model);
if (bad) { console.error(bad); process.exit(2); }
process.stdout.write(JSON.stringify(X.map((x) => predict(model, x))));
