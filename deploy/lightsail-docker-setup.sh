#!/usr/bin/env bash
# Amazon Lightsail (Ubuntu 22.04/24.04) 인스턴스에서 한 번만 실행: Docker 설치 + 배포 폴더 준비.
# 사용법: 이 저장소의 deploy/ 폴더를 서버에 올린 뒤  bash deploy/lightsail-docker-setup.sh
set -euo pipefail
DOW_HOME=/opt/dow
ME="$(whoami)"

echo "▶ Docker 설치"
if ! command -v docker >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io curl
  sudo systemctl enable --now docker
fi
sudo usermod -aG docker "$ME"

echo "▶ 배포 폴더 $DOW_HOME"
sudo mkdir -p "$DOW_HOME/saves"
sudo chown -R "$ME":"$ME" "$DOW_HOME"
cp "$(dirname "$0")"/deploy.sh "$(dirname "$0")"/rollback.sh "$DOW_HOME"/
chmod +x "$DOW_HOME"/*.sh

# 컨테이너 환경 변수 (버킷을 쓰면 채움). deploy.sh가 --env-file로 넘긴다.
if [[ ! -f "$DOW_HOME/env" ]]; then
  cat > "$DOW_HOME/env" <<'ENV'
# 저장소: 비우면 컨테이너 안 /app/saves/store (= 서버의 /opt/dow/saves/store)
# DOW_STORE=s3://버킷이름/dow
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=ap-northeast-2
MODEL_POLL_S=60
ENV
  chmod 600 "$DOW_HOME/env"
fi

# 예전 방식(systemd + node)으로 돌던 서비스가 있으면 끈다 (80번 포트 충돌 방지)
if systemctl list-unit-files | grep -q '^dow.service'; then
  echo "▶ 이전 systemd 서비스 중지"
  sudo systemctl disable --now dow || true
fi

echo
echo "✔ 준비 완료. 한 번 로그아웃했다가 다시 접속해야 docker 권한이 적용됩니다."
echo "  이후 GitHub Actions가 main에 병합될 때마다 자동으로 배포합니다."
echo "  배포 기록:   cat $DOW_HOME/deploys.log"
echo "  수동 롤백:   $DOW_HOME/rollback.sh"
