# 겨울의 생존자들 — 데드 오브 윈터 2인 협력 보드 도우미

데드 오브 윈터: 크로스로드 게임(본판)을 **두 사람이 각자 기기로 접속해** 함께 진행하는 웹 보드입니다.
공식 **2인 협력 변형**(공동목표 하드코어면, 비밀목표 없음, 시작 아이템 7장, 생존자 4명 중 3명, 비협력 카드 제외)을 기준으로 합니다.

> 판정은 플레이어가 직접 하고, 이 도구는 **상태 관리 · 덱 · 비공개 정보 · 계산 보조**를 맡습니다.
> 카드 데이터는 프로젝트의 `DoW-크로스드본판.pdf`(개인 번역 자료)에서 가져왔습니다. 카드·보드 그림도 원작 저작물이므로 **지인끼리 쓰는 비공개 용도로만 사용하고, 저장소는 반드시 Private으로 두며 사이트 주소를 공개 게시하지 마세요.**

## 이미지 (실물 보드·카드)

화면은 업로드한 TTS 모드 이미지로 그립니다: 피난기지 보드, 생존자 21칸 판, 플레이어 참조판, 카드 앞면 전부, 생존자 원형 초상, 좀비·부상·동상·바리케이드·소음·식량·굶주림·노약자 토큰, 사기·라운드 마커, 시작 플레이어 토큰.
원본 장소 카드 그림은 모드에 없어서 3D 건물 외벽 텍스처에서 잘라 썼습니다.

- 가공된 이미지: `public/assets/` (약 22MB, 이미 들어 있음)
- 매핑: `data/images.json`, 장소별 아이템 덱(카드마다 고유 그림): `data/item_cards.json`
- 다시 만들기: 이미지 ZIP(공용 + 본판 카드)을 한 폴더에 풀고
  `pip install pillow numpy && python3 tools/build_assets.py <푼 폴더> <데드오브윈터_1_본판_데이터.json>`

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

> 지금 운영 중인 서비스: **https://dow.eta.pyhub.kr** (Lightsail + Docker + GitHub Actions CI/CD, 아래 [CI/CD](#cicd-github-actions--lightsail) 참고)
> 작업 내용·진행 과정·결과 전체 정리는 [`프로젝트_정리.md`](프로젝트_정리.md)에 있습니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 서버 포트 |
| `SAVE_DIR` | `./saves` | 방 저장 폴더 |
| `ROOM_TTL_DAYS` | 14 | 이 기간 동안 활동 없는 방은 저장할 때 정리 |
| `DOW_STORE` | `SAVE_DIR/store` | 모델·데이터 저장소 (로컬 폴더 또는 `s3://버킷/접두사`) |
| `S3_ENDPOINT` | (없음) | S3 호환 저장소 주소를 직접 지정할 때 (로컬 테스트용 moto/MinIO 등) |
| `MODEL_POLL_S` | 60 | 레지스트리 확인 주기(초) |
| `AWS_REGION` | `ap-northeast-2` | 버킷 리전 (시드니 버킷이면 `ap-southeast-2`로 지정해야 함) |
| `MODEL_RELOAD_TOKEN` | (없음) | 지정하면 `POST /api/models/reload`(헤더 `x-reload-token`)로 즉시 모델 다시 읽기 |
| `GIT_SHA` | `dev` | `/healthz`에 표시할 코드 버전 (CI가 이미지를 빌드할 때 커밋 sha로 넣고, 배포 헬스체크가 이미지 태그와 비교) |

Lightsail에서는 이 값들을 서버의 `/opt/dow/env`에 적습니다. **파일을 고친 뒤에는 `docker restart`가 아니라 재배포해야 적용됩니다**(`/opt/dow/deploy.sh "$(cat /opt/dow/current)"`). `docker restart`는 env 파일을 다시 읽지 않습니다.

## 진행 방법 요약

1. 한 명이 방을 만들고 코드(또는 초대 링크)를 보냅니다. 공동목표와 면을 고릅니다.
2. 둘 다 들어오면 **게임 시작** → 각자 생존자 3명과 리더를 고릅니다.
3. 자기 턴: 생존자 칩을 눌러 이동·처치·탐색 등을 하고, 주사위는 눌러서 사용 표시합니다.
4. 상대 턴: 내 화면의 크로스로드 조건이 맞으면 **발동!** → 상대가 선택지를 고릅니다.
5. 둘 다 턴을 마치면 피난기지 단계 버튼을 위에서부터 차례로 누릅니다.
6. 실수했으면 상단 **↶ 되돌리기**.

## 파일 구조

```
server.js          방·소켓·저장·되돌리기·모델 API
game.js            게임 상태와 액션(보드 도우미 엔진)
data/              생존자·아이템·위기·공동목표·장소·크로스로드 데이터
public/            화면 (index.html, style.css, app.js)
ml/                특징값 정의, 시뮬레이션 봇, 서빙, 저장소, 학습 파이프라인(pipeline/), ML 테스트
tests/             엔진·서버·스트레스·재현성 테스트, 브라우저 e2e
deploy/            deploy.sh(배포·자동 롤백·HTTPS), rollback.sh, Lightsail 시작·설정 스크립트
.github/workflows/ ci-cd.yml(테스트→빌드→배포), train.yml(자동 학습), rollback.yml(코드·모델 롤백)
Dockerfile         서버 이미지
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
- **실제 게임 데이터:** 판이 끝나면 서버가 저장소(`DOW_STORE`, 기본 `saves/store`)의 `datasets/real/date=YYYY-MM-DD/<game_id>.jsonl`로 저장 (같은 형식, `source: "real"`)
- 봇: `ml/bot.js` (규칙 기반, skill 0.55~1로 실력 차를 둠). 크로스로드 효과는 아직 시뮬레이션하지 않음 → 실제 게임과의 차이(드리프트) 요인

## 테스트

| 명령 | 내용 | 시간 |
|---|---|---|
| `npm test` | 엔진 규칙 단위 테스트, 무작위 행동 150판 + 봇 300판 스트레스, 서버 통합(소켓 2개로 방→게임→되돌리기→재접속→기록 저장), 시뮬레이션 재현성 | 약 4초 |
| `python -m pytest ml/tests` | ML 파이프라인: 게이트 경계 사례, 레지스트리, 데이터 검증, 전체 흐름(parity 포함). 준비: `pip install -r ml/requirements.txt` | 약 30초 |
| `npm run test:e2e` | 브라우저 2개(데스크톱·모바일)로 실제 화면 조작, 서버 재시작 후 복원까지. 준비: `pip install playwright -r ml/requirements.txt && python -m playwright install --with-deps chromium` | 약 20초 |

## CI/CD (GitHub Actions → Lightsail)

```
PR / push ─▶ 단위·통합 테스트 ─┬─▶ 브라우저 e2e ─┐
           └▶ ML 테스트 ───────┴────────────────┼─(main만)─▶ Docker 이미지 빌드 → GHCR(ghcr.io/<owner>/<repo>:<커밋sha>)
                                                │              └─▶ SSH로 Lightsail 배포 → 헬스체크(버전 일치)
                                                │                     │ 실패 시 서버에서 직전 이미지로 자동 롤백
                                                │                     └─▶ 밖에서 https://<도메인>/healthz 버전 확인
수동 롤백: Actions 탭 → Rollback → Run workflow (비우면 직전 버전)
```

### 처음 한 번 설정

1. **저장소:** 이 폴더를 GitHub **Private** 저장소로 올립니다.
2. **Lightsail 인스턴스** (예: 시드니, Amazon Linux 2023, 2GB)
   - 만들 때 **고급 설정 → 시작 스크립트**에 `deploy/launch-script-lightsail.sh` 내용을 붙여 넣습니다. Docker·git과 셸 도구를 설치하고 `/opt/dow`(배포 폴더)와 `/opt/dow/env`를 만듭니다. 로그는 `/var/log/cloud-init-output.log`에 남습니다.
   - SSH 키는 직접 만든 키를 쓰는 경우 **만들 때 한 번만** 개인키(`.pem`)를 내려받을 수 있으니 잘 보관합니다.
   - **네트워킹:** 고정 IP를 붙이고, 방화벽 **IPv4와 IPv6 모두**에 SSH(22)·HTTP(80)·HTTPS(443)를 엽니다.
   - 이미 만든 인스턴스(Ubuntu 포함)라면 시작 스크립트 대신 `deploy/` 폴더를 올려 `bash deploy/lightsail-docker-setup.sh`를 한 번 실행하고 다시 접속합니다.
3. **GitHub 설정** (Settings → Secrets and variables → Actions)
   - Secrets: `LIGHTSAIL_HOST`(고정 IP), `LIGHTSAIL_USER`(Amazon Linux는 `ec2-user`, Ubuntu는 `ubuntu`), `LIGHTSAIL_SSH_KEY`(`.pem` 내용 전체, `-----BEGIN`부터 `-----END`까지)
   - Variables: `DEPLOY_ENABLED` = `true` (없으면 테스트·빌드까지만 하고 배포는 건너뜀)
   - Variables: `DOW_DOMAIN` = 도메인 (선택, 아래 HTTPS)
   - Environments에 `production`을 만들면 배포 전 승인 단계를 둘 수도 있습니다.
4. main에 병합하면 자동으로 배포됩니다. `/healthz`에서 지금 돌고 있는 커밋을 확인할 수 있습니다.
5. 버킷을 쓰려면 아래 [Lightsail 버킷 연결](#lightsail-버킷-연결)을 이어서 합니다.

### HTTPS (도메인)

1. 도메인의 A 레코드를 고정 IP로 연결합니다. `nslookup <도메인>`으로 고정 IP가 나오는지 확인합니다.
2. 저장소 **Variables**에 `DOW_DOMAIN`(예: `dow.eta.pyhub.kr`)을 추가하고 다시 배포합니다.
3. `deploy.sh`가 앱 앞에 Caddy 컨테이너(`dow-caddy`)를 띄웁니다.
   - Caddy가 80·443을 받고 Let's Encrypt 인증서를 자동으로 발급·갱신합니다. HTTP는 HTTPS로 자동 이동합니다.
   - 앱(`dow-app`)은 서버 안의 `127.0.0.1:3000`에만 열립니다.
   - 도메인은 서버의 `/opt/dow/domain`에 기억되어, 서버에서 직접 하는 수동 롤백 때도 유지됩니다.
4. 배포 워크플로의 마지막 확인도 `https://<도메인>/healthz`로 바뀝니다.

- 서버에서 확인: `docker ps` (dow-app, dow-caddy), `cat /opt/dow/Caddyfile`, `docker logs dow-caddy --tail 30`
- 브라우저에 "이 사이트는 보안 연결을 지원하지 않습니다"가 뜨면 방화벽 443이 닫혀 있는 경우가 대부분입니다.
- HTTPS 끄기: Variables에서 `DOW_DOMAIN`을 지우고 서버의 `/opt/dow/domain` 파일을 지운 뒤 재배포합니다.

### 배포 방식과 롤백

- **교체 순서:** 기존 컨테이너를 정상 종료(진행 중인 방을 `saves/`에 저장) → 새 컨테이너 시작(방 복원) → `/healthz`의 버전이 새 커밋과 같은지 확인. 교체 중 몇 초 끊깁니다. 두 서버가 같은 저장 파일을 동시에 쓰지 않도록 일부러 블루/그린 방식을 쓰지 않았습니다.
- **자동 롤백:** 헬스체크가 60초 안에 통과하지 못하면 직전 이미지로 다시 띄웁니다. 이미지를 받지 못했고 서버에도 없으면 기존 서비스를 건드리지 않고 멈춥니다.
- **수동 롤백:** Actions → Rollback(target=code), 또는 서버에서 `/opt/dow/rollback.sh`(직전 버전), `/opt/dow/rollback.sh <이미지:태그>`(지정 버전). 다시 실행하면 롤백이 취소됩니다. 지금 버전을 넘기면 "이미 … 버전입니다"만 출력하고 아무것도 하지 않습니다.
- **기록:** `/opt/dow/current`, `/opt/dow/previous`, `/opt/dow/deploys.log`
- 진행 중인 방과 실제 게임 학습 기록(`saves/`)은 서버의 `/opt/dow/saves`에 남아 배포·롤백과 무관하게 유지됩니다.

## MLOps 파이프라인 (학습 → 게이트 → 서빙 → 모니터링 → 롤백)

```
 친구와 한 판 ─(게임 종료)─▶ 저장소 datasets/real/  ◀─ 라운드마다 운영 모델 예측도 함께 기록
 봇 시뮬레이션 ─────────────▶ 저장소 datasets/sim/
                                   │
 Train 워크플로(매일 03:17 KST / 수동)
   ① 데이터 적재  ② 검증(스키마·특징 수·NaN·라벨 분포)  ③ 학습(로지스틱 회귀, 실제 게임은 가중치 3)
   ④ 게이트: 고정 검증 세트 eval/sim-v1에서 후보와 운영 모델을 그 자리에서 다시 평가
        기준선보다 나음 · AUC/Brier 유지(허용 오차) · 공동목표별 조각 비교 · 실제 게임 검증(100행 이상일 때)
   ⑤ parity: Python 학습 결과 vs Node 서빙 결과 최대 차이 1e-9 이하 (실제 약 5e-16)
   ⑥ 레지스트리 등록: 통과 → active(이전은 archived) / 실패 → rejected + 사유
   ⑦ 모니터링: 시뮬레이션 vs 실제 분포 차이(PSI, 실제 30행부터),
              실제 게임 예측 성능(AUC·Brier·보정 오차, 예측이 기록된 실제 라운드 20개부터)
                                   │
 게임 서버: registry.json을 60초마다 확인 → active가 바뀌면 재배포 없이 모델 교체
            /api/predict · /api/models · /healthz(운영 모델 버전) · 화면 "AI 예측" 게이지
```

| 무엇 | 어디 |
|---|---|
| 파이프라인 | `ml/pipeline/` (`run.py` 실행, `gate.py`, `registry.py`, `monitor.py`, `data.py`, `model.py`, `store.py`) |
| 서빙 | `ml/serving.js`, 서버의 `/api/predict` |
| 시연용 실제 게임 대역 | `ml/simulate.js --store` (행에 `demo: true`) |

### 로컬에서 한 바퀴 돌려 보기

```bash
pip install -r ml/requirements.txt
python3 -m ml.pipeline.run --store saves/store                    # 첫 모델 학습 → 승격
npm start                                                         # 서버가 saves/store의 모델을 읽어 게이지 표시
node ml/simulate.js --store saves/store --games 120        # (시연) 실제 게임 대역 → 모니터링 데이터
python3 -m ml.pipeline.run --store saves/store                    # 재학습: 게이트 비교 + 드리프트 리포트
python3 -m ml.pipeline.run --store saves/store --label-noise 0.4  # (시연) 오염된 라벨 → 게이트가 차단
python3 -m ml.pipeline.registry --store saves/store show          # 레지스트리 상태
python3 -m ml.pipeline.registry --store saves/store rollback --task y_crisis   # 모델 롤백
```

리포트는 저장소의 `reports/<실행시각>.json|.txt`와 `reports/latest.json`에 남고, GitHub Actions에서는 실행 요약 화면에도 표시됩니다.

### Lightsail 버킷 연결

1. Lightsail 콘솔 → **스토리지 → 버킷 생성** (인스턴스와 같은 리전, 예: 시드니)
2. 버킷 → **권한 → 리소스 액세스**에서 인스턴스를 연결합니다. 이렇게 하면 **서버에는 키를 두지 않아도** 됩니다(인스턴스 자격 증명 사용).
3. 버킷 → **권한 → 액세스 키 → 액세스 키 생성** (GitHub Actions 학습용. 키 ID와 비밀 키는 이때만 보이니 보관)
4. **서버:** `/opt/dow/env`를 아래처럼 쓰고 재배포로 적용합니다.
   ```bash
   cat > /opt/dow/env <<'ENV'
   DOW_STORE=s3://<버킷이름>/dow
   AWS_REGION=ap-southeast-2
   ENV
   chmod 600 /opt/dow/env
   /opt/dow/deploy.sh "$(cat /opt/dow/current)"
   ```
   - `DOW_STORE`는 GitHub Secret의 `DOW_STORE`와 **완전히 같아야** 합니다(버킷 이름과 `/dow` 접두사까지).
   - 리소스 액세스 대신 키를 쓰려면 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 줄을 더합니다.
   - 브라우저 SSH에서 nano로 열면 한글 주석이 깨져 보일 수 있습니다. 파일은 정상이며, 위처럼 통째로 다시 쓰면 간단합니다.
5. **GitHub Secrets:** `DOW_STORE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — Train·Rollback(model) 워크플로가 같은 버킷을 씁니다.
6. **확인:** `https://<도메인>/api/models`에서 `"store":"s3"`이고 과제별 모델 버전이 보이면 연결된 것입니다. `"store":"local"`이면 서버 env에 `DOW_STORE`가 빠진 것이고, `last_error`에 자격 증명 오류가 있으면 리소스 액세스 연결(또는 키)을 확인합니다.
7. 버킷이 없으면 서버는 `/opt/dow/saves/store`(로컬), Train 워크플로는 실행기 임시 폴더를 쓰고 결과를 아티팩트로 남깁니다(연습용). 이 경우 GitHub에서 학습한 모델은 서버에 전달되지 않습니다.

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

### 모델 롤백

- 방법: Actions → Rollback(target=model), 또는 `python -m ml.pipeline.registry --store … rollback --task …`. 서버가 다음 확인 주기(기본 60초)에 자동으로 적용합니다.
- 모델 롤백은 과제별로 따로 됩니다(`y_crisis`만 되돌리면 `y_collapse`는 그대로).
- **승격이 두 번 이상 있어야 롤백할 수 있습니다.** 되돌아갈 `archived` 모델이 없으면 "되돌릴 이전 모델이 없습니다"로 실패합니다. 차단(rejected)된 실행은 운영 모델을 바꾸지 않으므로 롤백 대상이 생기지 않습니다.
- 시연 순서 예: 승격(label_noise 0) → 승격 → 차단(label_noise 0.4) → 롤백. Train의 **Re-run**은 이전 입력값을 그대로 쓰므로, 입력을 바꾸려면 **Run workflow**로 새로 실행합니다.

모델과 코드의 배포·롤백이 분리되어 있어서, 모델만 바꾸거나 되돌릴 때 서버를 재시작하지 않습니다. 단, 특징값 정의(`ml/features.js`)가 바뀌면 서버가 스키마를 확인해 맞지 않는 모델은 쓰지 않습니다(학습·서빙 불일치 방지).

### 알려진 한계

- 봇 승률이 3.6%로 사람보다 많이 약해서 "최종 승리" 예측은 아직 하지 않습니다(위기 성공·붕괴 위험 두 과제만).
- 시뮬레이션은 크로스로드 효과를 처리하지 않아 실제 게임과 분포가 다릅니다. 이 차이는 모니터링의 PSI로 드러나도록 해 두었습니다.
