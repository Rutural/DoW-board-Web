# 겨울의 생존자들 — 데드 오브 윈터 2인 협력 보드 도우미

데드 오브 윈터: 크로스로드 게임(본판)을 **두 사람이 각자 기기로 접속해** 함께 진행하는 웹 보드입니다.
공식 **2인 협력 변형**(공동목표 하드코어면, 비밀목표 없음, 시작 아이템 7장, 생존자 4명 중 3명, 비협력 카드 제외)을 기준으로 합니다.

> 판정은 플레이어가 직접 하고, 이 도구는 **상태 관리 · 덱 · 비공개 정보 · 계산 보조**를 맡습니다.
> 카드 데이터는 프로젝트의 `DoW-크로스드본판.pdf`(개인 번역 자료)에서 가져왔습니다. **지인끼리 쓰는 비공개 용도로만 사용하고, 저장소는 반드시 Private으로 두세요.**

## 이미지 (실물 보드·카드)

화면은 업로드한 TTS 모드 이미지로 그립니다: 피난기지 보드, 생존자 21칸 판, 플레이어 참조판, 카드 앞면 전부, 생존자 원형 초상, 좀비·부상·동상·바리케이드·소음·식량·굶주림·노약자 토큰, 사기·라운드 마커, 시작 플레이어 토큰.
원본 장소 카드 그림은 모드에 없어서 3D 건물 외벽 텍스처에서 잘라 썼습니다.

- 가공된 이미지: `public/assets/` (약 22MB, 이미 들어 있음)
- 매핑: `data/images.json`, 장소별 아이템 덱(카드마다 고유 그림): `data/item_cards.json`
- 다시 만들기: 이미지 ZIP(공용 + 본판 카드)을 한 폴더에 풀고
  `pip install pillow numpy && python3 tools/build_assets.py <푼 폴더> <데드오브윈터_1_본판_데이터.json>`

⚠ 카드·보드 그림은 원작 저작물입니다. 지인끼리 쓰는 비공개 사이트로만 운영하고, 주소를 공개 게시하지 마세요.

## 할 수 있는 것

| 영역 | 기능 |
|---|---|
| 방 | 4글자 코드 · 초대 링크 · 같은 기기 자동 재접속 · 서버 재시작 후에도 방 복원 |
| 준비 | 공동목표 10종 × 일반/하드면, 시작 아이템 7장 분배, 생존자 4장 중 3명 + 리더 선택, 목표별 좀비·노약자 자동 배치, 시작 플레이어 결정 |
| 라운드 | 위기 자동 공개, 주사위 자동 굴림(1 + 생존자 + 야간 투시경), 턴 시작 시 동상 부상 자동, 크로스로드를 상대가 비공개로 자동 뽑기 |
| 보드 | 피난기지 입구 6개 × 3칸, 장소별 입구·소음·덱 장수, 생존자 칩(부상·동상·장착·리더 표시), 노약자, 쓰레기장 |
| 생존자 | 이동(위험노출 굴림/연료/굴림 없음), 좀비 처치, 탐색, 바리케이드, 부상·동상, 능력·장착 카드 사용 표시, 긴급 전달, 메모(말·스노모빌 등 부착 카드), 리더 변경, 넘기기, 사망/게임에서 제거 |
| 자동 계산 | 위험노출 12면 주사위, 물림 확산(죽기/재굴림 선택), 부상 3개(버디 4개) 사망, 마지막 생존자 사망 처리, 좀비 입구 순서 배치 · 바리케이드 파괴 · 침입 경고, 소음 굴림 |
| 카드 | 손패(비공개/공개 전환), 사용·장착·위기 기여(뒷면)·목표 아래·건네기·쓰레기장·제거, 탐색(소음 내고 더 보기, 여러 장 획득), 쓰레기장/제거 더미에서 찾기 |
| 위기 | 기여 카드 섞어 공개, +1/−1 점수 계산, 2점 성공 · 4점 사기 +1 자동, 실패 효과 안내, 위기 건너뛰기 |
| 크로스로드 | 74장(비협력 제외, 성인 테마 선택), 발동 조건 · 지문 · 선택지 · 효과 요약, 발동→선택→완료 흐름, 미발동 시 덱 아래 |
| 피난기지 단계 | 식량(굶주림 누적) → 쓰레기 → 위기 → 좀비 → 공동목표 → 라운드·시작 플레이어, 단계별 버튼 |
| 기타 | 되돌리기 40단계, 진행 중 효과 메모, 기록·채팅, 규칙 요약, 모바일 화면 |

## 로컬에서 실행

```bash
npm install
npm start            # http://localhost:3000
```

같은 와이파이의 다른 기기에서는 `http://<내 PC IP>:3000` 으로 접속할 수 있습니다.

## 배포 — 둘 중 하나를 고르세요

### A. Render (가장 간단, 무료 가능)

1. 이 폴더를 GitHub **Private** 저장소로 올립니다.
2. Render 대시보드 → **New → Blueprint** → 저장소 선택 (`render.yaml`이 자동으로 읽힘).
   또는 **New → Web Service** → Build `npm ci --omit=dev`, Start `node server.js`.
3. 배포가 끝나면 `https://dow-board-helper.onrender.com` 같은 **고정 주소**가 생깁니다.

주의할 점
- 무료 플랜은 **15분 동안 접속이 없으면 잠듭니다.** 첫 접속에 30초~1분 걸릴 수 있어요.
- 무료 플랜 디스크는 재배포·재시작 때 초기화되어 **진행 중인 방이 사라질 수 있습니다.** 이어서 하려면 유료 플랜에 Persistent Disk를 붙이고 환경 변수 `SAVE_DIR=/var/data`(디스크 마운트 경로)를 지정하세요.

### B. Amazon Lightsail (항상 켜져 있음, 저장 유지)

1. Lightsail → 인스턴스 생성 → **Linux/Unix · OS Only · Ubuntu 24.04** · 가장 작은 플랜.
2. **Networking → Create static IP** 로 고정 IP를 붙입니다. (이 IP가 고정 주소)
3. 방화벽에 **HTTP(80)** 가 열려 있는지 확인합니다.
4. 이 폴더를 서버에 올립니다. 예: `scp -r dow ubuntu@<고정IP>:~/` (또는 Private 저장소를 `git clone`)
5. 서버에 SSH로 접속해 실행:
   ```bash
   cd ~/dow && bash deploy/lightsail-setup.sh
   ```
6. 브라우저에서 `http://<고정 IP>` 로 접속합니다.

도메인을 쓰려면 Lightsail **Domains & DNS**에서 A 레코드를 고정 IP로 연결하세요. HTTPS가 필요하면 nginx + certbot을 앞에 두고 `PORT=3000`으로 바꾸면 됩니다.

업데이트: 새 파일을 올린 뒤 `npm ci --omit=dev && sudo systemctl restart dow`.

### Render와 Lightsail을 함께 쓴다면

두 곳은 **서로 다른 서버**라서 방이 공유되지 않습니다. 한쪽을 주 서버로 정하고 다른 쪽은 예비로 두세요.
(예: 평소엔 Lightsail, Lightsail 점검 중에는 Render)

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 서버 포트 |
| `SAVE_DIR` | `./saves` | 방 저장 폴더 (14일 동안 활동 없는 방은 자동 정리) |
| `ROOM_TTL_DAYS` | 14 | 이 기간 동안 활동 없는 방은 저장할 때 정리 |
| `DOW_STORE` | `SAVE_DIR/store` | 모델·데이터 저장소 (로컬 폴더 또는 `s3://버킷/접두사`) |
| `S3_ENDPOINT` | (없음) | S3 호환 저장소 주소를 직접 지정할 때 (로컬 테스트용 moto/MinIO 등) |
| `MODEL_POLL_S` | 60 | 레지스트리 확인 주기(초) |

## 진행 방법 요약

1. 한 명이 방을 만들고 코드(또는 초대 링크)를 보냅니다. 공동목표와 면을 고릅니다.
2. 둘 다 들어오면 **게임 시작** → 각자 생존자 3명과 리더를 고릅니다.
3. 자기 턴: 생존자 칩을 눌러 이동·처치·탐색 등을 하고, 주사위는 눌러서 사용 표시합니다.
4. 상대 턴: 내 화면의 크로스로드 조건이 맞으면 **발동!** → 상대가 선택지를 고릅니다.
5. 둘 다 턴을 마치면 피난기지 단계 버튼을 위에서부터 차례로 누릅니다.
6. 실수했으면 상단 **↶ 되돌리기**.

## 파일 구조

```
server.js          방·소켓·저장·되돌리기
game.js            게임 상태와 액션(보드 도우미 엔진)
data/              생존자·아이템·위기·공동목표·장소·크로스로드 데이터
public/            화면 (index.html, style.css, app.js)
deploy/            Lightsail 설치 스크립트
render.yaml        Render 블루프린트
Dockerfile         컨테이너 배포용 (Lightsail Containers 등)
```

## 다음에 추가할 만한 것

- 3~5인 기본 규칙(비밀목표·배반자·추방 투표)
- 확장 『기나긴 밤』·『식민지 전쟁』 데이터
- 자주 쓰는 크로스로드 효과의 원클릭 적용

## 학습 데이터 (MLOps 미니 프로젝트)

라운드가 시작될 때마다 게임 상태를 특징값 57개로 기록하고, 결과를 라벨로 붙입니다.

| 라벨 | 뜻 | 시뮬레이션 기준 비율 |
|---|---|---|
| `y_crisis` | 이번 라운드 위기를 막았는가 | 성공 약 60% |
| `y_collapse` | 이 라운드 안에 게임이 패배로 무너졌는가 | 약 27% |
| `y_morale_delta` | 다음 라운드 시작까지 사기 변화량 | 평균 −1.6 |
| `y_win` | 최종 승리 | 약 3.6% (봇이 약해서 아직 쓰기 어려움) |

- 특징값 정의: `ml/features.js` — 학습과 서빙이 이 파일 하나를 함께 씀(parity 기준)
- **시뮬레이션 데이터:** `node ml/simulate.js --games 5000 --seed 7` → `datasets/sim/<run_id>/rows.jsonl` + `manifest.json`
  (시드, 엔진·특징·봇 버전 해시, 판 수, 라벨 통계, 파일 sha256 기록 → 같은 시드면 같은 데이터)
- **실제 게임 데이터:** 판이 끝나면 서버가 `saves/datasets/real/date=YYYY-MM-DD/<game_id>.jsonl`로 저장 (같은 형식, `source: "real"`)
- 봇: `ml/bot.js` (규칙 기반, skill 0.55~1로 실력 차를 둠). 크로스로드 효과는 아직 시뮬레이션하지 않음 → 실제 게임과의 차이(드리프트) 요인
- 엔진 보강: 위기 실패 효과 자동 적용 버튼, 침입 사망 자동 처리, 공동목표 자동 판정(참고 표시)

## 테스트

| 명령 | 내용 | 시간 |
|---|---|---|
| `npm test` | 엔진 규칙 단위 테스트 15개, 무작위 행동 150판 + 봇 300판 스트레스, 서버 통합(소켓 2개로 방→게임→되돌리기→재접속→기록 저장), 시뮬레이션 재현성 | 약 4초 |
| `npm run test:e2e` | 브라우저 2개(데스크톱·모바일)로 실제 화면 조작 14개 항목, 서버 재시작 후 복원까지. 준비: `pip install playwright && python -m playwright install --with-deps chromium` | 약 20초 |

## CI/CD (GitHub Actions → Lightsail)

```
PR / push ─▶ 단위·통합 테스트 ─▶ 브라우저 e2e ─┐
                                              ├─(main만)─▶ Docker 이미지 빌드 → GHCR(ghcr.io/<owner>/<repo>:<커밋sha>)
                                              │              └─▶ SSH로 Lightsail 배포 → 헬스체크(버전 일치)
                                              │                     └ 실패 시 서버에서 직전 이미지로 자동 롤백
수동 롤백: Actions 탭 → Rollback → Run workflow (비우면 직전 버전)
```

### 처음 한 번 설정

1. **저장소:** 이 폴더를 GitHub **Private** 저장소로 올립니다.
2. **Lightsail 인스턴스:** Ubuntu 24.04, 고정 IP 연결, 방화벽 HTTP(80)·SSH(22) 허용.
3. **서버 준비:** `deploy/` 폴더를 서버에 올리고 실행합니다. 실행 후 다시 접속하세요.
   ```bash
   scp -r deploy ubuntu@<고정IP>:~/ && ssh ubuntu@<고정IP> 'bash ~/deploy/lightsail-docker-setup.sh'
   ```
4. **GitHub 설정** (Settings → Secrets and variables → Actions)
   - Secrets: `LIGHTSAIL_HOST`(고정 IP), `LIGHTSAIL_USER`(`ubuntu`), `LIGHTSAIL_SSH_KEY`(Lightsail 기본 키 `.pem` 내용 전체)
   - Variables: `DEPLOY_ENABLED` = `true` (없으면 테스트·빌드까지만 하고 배포는 건너뜀)
   - Environments에 `production`을 만들면 배포 전 승인 단계를 둘 수도 있습니다.
5. main에 병합하면 자동으로 배포됩니다. `http://<고정IP>/healthz`에서 지금 돌고 있는 커밋을 확인할 수 있습니다.

### 배포 방식과 롤백

- **교체 순서:** 기존 컨테이너를 정상 종료(진행 중인 방을 `saves/`에 저장) → 새 컨테이너 시작(방 복원) → `/healthz`의 버전이 새 커밋과 같은지 확인. 교체 중 몇 초 끊깁니다. 두 서버가 같은 저장 파일을 동시에 쓰지 않도록 일부러 블루/그린 방식을 쓰지 않았습니다.
- **자동 롤백:** 헬스체크가 60초 안에 통과하지 못하면 직전 이미지로 다시 띄웁니다. 이미지를 받지 못하면 기존 서비스를 건드리지 않습니다.
- **수동 롤백:** 서버에서 `/opt/dow/rollback.sh`(직전 버전), `/opt/dow/rollback.sh <이미지:태그>`(지정 버전). 다시 실행하면 롤백이 취소됩니다.
- **기록:** `/opt/dow/current`, `/opt/dow/previous`, `/opt/dow/deploys.log`
- 진행 중인 방과 실제 게임 학습 기록(`saves/`)은 서버의 `/opt/dow/saves`에 남아 배포·롤백과 무관하게 유지됩니다.

> 예전 방식(`deploy/lightsail-setup.sh`, systemd + node 직접 실행)은 CI/CD 없이 수동으로 올릴 때만 쓰세요. Docker 설정 스크립트가 예전 서비스를 자동으로 끕니다.

## MLOps 파이프라인 (학습 → 게이트 → 서빙 → 모니터링 → 롤백)

```
 친구와 한 판 ─(게임 종료)─▶ 저장소 datasets/real/  ◀─ 라운드마다 운영 모델 예측도 함께 기록
 봇 시뮬레이션 ─────────────▶ 저장소 datasets/sim/
                                   │
 Train 워크플로(매일 03:17 KST / 수동)
   ① 데이터 적재  ② 검증(스키마·특징 수·NaN·라벨 분포)  ③ 학습(로지스틱 회귀, 실제 게임은 가중치 3)
   ④ 게이트: 고정 검증 세트 eval/sim-v1에서 후보와 운영 모델을 그 자리에서 다시 평가
        기준선보다 나음 · AUC/Brier 유지(허용 오차) · 공동목표별 조각 비교 · 실제 게임 검증(100행 이상일 때)
   ⑤ parity: Python 학습 결과 vs Node 서빙 결과 최대 차이 1e-9 이하
   ⑥ 레지스트리 등록: 통과 → active(이전은 archived) / 실패 → rejected + 사유
   ⑦ 모니터링: 시뮬레이션 vs 실제 분포 차이(PSI), 실제 게임 예측 성능(AUC·Brier·보정 오차)
                                   │
 게임 서버: registry.json을 60초마다 확인 → active가 바뀌면 재배포 없이 모델 교체
            /api/predict · /api/models · /healthz(운영 모델 버전) · 화면 "AI 예측" 게이지
```

| 무엇 | 어디 |
|---|---|
| 특징값 정의 (학습·서빙 공용) | `ml/features.js` |
| 파이프라인 | `ml/pipeline/` (`run.py` 실행, `gate.py`, `registry.py`, `monitor.py`, `data.py`, `model.py`, `store.py`) |
| 서빙 | `ml/serving.js`, 서버의 `/api/predict` |
| 시연용 실제 게임 대역 | `ml/demo_real_games.js` (행에 `demo: true`) |
| 테스트 | `python -m pytest ml/tests` (18개: 게이트 엣지 케이스, 레지스트리, 데이터 검증, 전체 흐름) |

### 로컬에서 한 바퀴 돌려 보기

```bash
pip install -r ml/requirements.txt
python3 -m ml.pipeline.run --store saves/store                    # 첫 모델 학습 → 승격
npm start                                                         # 서버가 saves/store의 모델을 읽어 게이지 표시
node ml/demo_real_games.js --store saves/store --games 120        # (시연) 실제 게임 대역 → 모니터링 데이터
python3 -m ml.pipeline.run --store saves/store                    # 재학습: 게이트 비교 + 드리프트 리포트
python3 -m ml.pipeline.run --store saves/store --label-noise 0.4  # (시연) 오염된 라벨 → 게이트가 차단
python3 -m ml.pipeline.registry --store saves/store show          # 레지스트리 상태
python3 -m ml.pipeline.registry --store saves/store rollback --task y_crisis   # 모델 롤백
```

리포트는 저장소의 `reports/<실행시각>.json|.txt`와 `reports/latest.json`에 남고, GitHub Actions에서는 실행 요약 화면에도 표시됩니다.

### Lightsail 버킷 연결

1. Lightsail 콘솔 → **Storage → Create bucket** (예: `dow-mlops`, 서울 리전)
2. 버킷 → **Permissions → Access keys → Create access key** (키 ID와 비밀 키 보관)
3. **서버:** `/opt/dow/env` 파일에서 주석을 풀고 채운 뒤 `/opt/dow/rollback.sh "$(cat /opt/dow/current)"`(같은 버전 재시작)나 다음 배포로 적용
   ```
   DOW_STORE=s3://dow-mlops/dow
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=ap-northeast-2
   ```
4. **GitHub Secrets:** `DOW_STORE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — Train·Rollback(model) 워크플로가 같은 버킷을 씁니다.
5. 버킷이 없으면 서버는 `/opt/dow/saves/store`(로컬), Train 워크플로는 실행기 임시 폴더를 쓰고 결과를 아티팩트로 남깁니다(연습용).

### 버킷 코드를 로컬에서 미리 확인하기 (AWS 없이)

S3 호환 테스트 서버(moto)로 버킷 경로 전체를 확인할 수 있습니다.

```bash
pip install "moto[server]"
moto_server -p 9100 &
export S3_ENDPOINT=http://127.0.0.1:9100 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
python -c "import boto3; boto3.client('s3', endpoint_url='http://127.0.0.1:9100').create_bucket(Bucket='dow-mlops')"
python -m ml.pipeline.run --store s3://dow-mlops/dow --games 1500
docker build -t dow-board-helper:local .
docker run --rm -p 3950:3000 -e DOW_STORE=s3://dow-mlops/dow -e S3_ENDPOINT=http://host.docker.internal:9100   -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_REGION=us-east-1 -e MODEL_POLL_S=2 dow-board-helper:local
curl http://127.0.0.1:3950/healthz      # models에 방금 학습한 버전이 보이면 성공
```

실제 Lightsail 버킷에서는 `S3_ENDPOINT`를 지정하지 않습니다(AWS 기본 주소 사용).

### 롤백 정리

| 대상 | 방법 | 적용 |
|---|---|---|
| 코드(서버) | 배포 실패 시 자동 / Actions → Rollback(target=code) / 서버에서 `/opt/dow/rollback.sh` | 즉시 |
| 모델 | Actions → Rollback(target=model) / `python -m ml.pipeline.registry --store … rollback --task …` | 서버가 다음 확인 주기(기본 60초)에 자동 적용 |

모델과 코드의 배포·롤백이 분리되어 있어서, 모델만 바꾸거나 되돌릴 때 서버를 재시작하지 않습니다. 단, 특징값 정의(`ml/features.js`)가 바뀌면 서버가 스키마를 확인해 맞지 않는 모델은 쓰지 않습니다(학습·서빙 불일치 방지).

### 알려진 한계

- 봇 승률이 3.6%로 사람보다 많이 약해서 "최종 승리" 예측은 아직 하지 않습니다(위기 성공·붕괴 위험 두 과제만).
- 시뮬레이션은 크로스로드 효과를 처리하지 않아 실제 게임과 분포가 다릅니다. 이 차이는 모니터링의 PSI로 드러나도록 해 두었습니다.
- 실제 게임이 쌓이기 전까지는 게이트의 "실제 게임 검증" 항목이 건너뛰어집니다(100행 이상부터 비교).
