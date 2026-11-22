#!/usr/bin/env bash
# Amazon Lightsail (Ubuntu 22.04/24.04) 인스턴스에서 한 번 실행하는 설치 스크립트.
# 사용법: 이 폴더 전체를 서버에 올린 뒤  bash deploy/lightsail-setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(whoami)"

echo "▶ Node.js 22 설치"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "▶ 패키지 설치"
cd "$APP_DIR"
npm ci --omit=dev

echo "▶ systemd 서비스 등록 (80번 포트로 직접 실행)"
sudo tee /etc/systemd/system/dow.service >/dev/null <<EOF
[Unit]
Description=Dead of Winter board helper
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=PORT=80
Environment=SAVE_DIR=${APP_DIR}/saves
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dow
sleep 2
sudo systemctl --no-pager status dow | head -5
echo
echo "✔ 완료. 브라우저에서 http://<고정 IP> 로 접속하세요."
echo "  로그 보기:   sudo journalctl -u dow -f"
echo "  재시작:      sudo systemctl restart dow"
