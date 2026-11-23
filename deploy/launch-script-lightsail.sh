#!/bin/bash
# Lightsail 인스턴스 생성 화면 → 고급 설정 → 시작 스크립트 추가 에 그대로 붙여 넣는다.
# 인스턴스를 처음 켤 때 한 번 돈다(root). 로그 : /var/log/cloud-init-output.log
# 수업(03 웹콘솔 Lightsail)의 launch-script-lightsail.sh 와 같고, 배포 폴더만 이 프로젝트용(/opt/dow)으로 바꿨다.
# 서버에는 Docker 만 깐다. 이미지는 GitHub(GHCR)에서 받고, 모델은 버킷에서 받는다
set -euo pipefail
ARCH=$(uname -m)

# ── Docker + Compose 플러그인 (Amazon Linux 2023 의 docker 패키지에는 Compose 가 없다) ──
dnf install -y docker git zsh util-linux-user libicu perl-Digest-SHA
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$ARCH" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# ── 배포 폴더 : 배포·롤백 스크립트, 방 저장(saves), 컨테이너 환경 변수(env) ──
install -d -o ec2-user -g ec2-user /opt/dow /opt/dow/saves
cat > /opt/dow/env <<'ENV'
# 저장소: 비우면 컨테이너 안 /app/saves/store (= 서버의 /opt/dow/saves/store)
# 버킷을 인스턴스에 연결한 뒤 아래 DOW_STORE 줄의 # 를 지우고 버킷 이름을 넣는다
# DOW_STORE=s3://버킷이름/dow
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-2
MODEL_POLL_S=60
ENV
chown ec2-user:ec2-user /opt/dow/env
chmod 600 /opt/dow/env

# ── 편한 셸 : zsh + oh-my-zsh + powerlevel10k, 편집기 nvim ──
NVIM_ARCH=$(echo "$ARCH" | sed 's/aarch64/arm64/')
curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-$NVIM_ARCH.tar.gz" | tar -xz -C /opt
ln -sf "/opt/nvim-linux-$NVIM_ARCH/bin/nvim" /usr/local/bin/nvim
sudo -u ec2-user sh -c 'RUNZSH=no CHSH=no sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended'
sudo -u ec2-user git clone --depth 1 https://github.com/romkatv/powerlevel10k.git \
  /home/ec2-user/.oh-my-zsh/custom/themes/powerlevel10k
# 브라우저 SSH 에는 아이콘 글꼴이 없다 : 설정 마법사 없이 글꼴을 타지 않는 lean 테마로
sudo -u ec2-user cp /home/ec2-user/.oh-my-zsh/custom/themes/powerlevel10k/config/p10k-lean.zsh /home/ec2-user/.p10k.zsh
sed -i 's/POWERLEVEL9K_MODE=nerdfont-complete/POWERLEVEL9K_MODE=ascii/' /home/ec2-user/.p10k.zsh
sed -i 's|^ZSH_THEME=.*|ZSH_THEME="powerlevel10k/powerlevel10k"|' /home/ec2-user/.zshrc
cat >> /home/ec2-user/.zshrc <<'ZRC'
# 브라우저 SSH 는 창 제목 바꾸기 신호를 몰라 명령 글자와 % 가 찍힌다 : oh-my-zsh 의 자동 제목을 끈다
DISABLE_AUTO_TITLE=true
POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh
alias vi=nvim vim=nvim
ZRC
usermod -s /bin/zsh ec2-user
echo "launch-script done"
