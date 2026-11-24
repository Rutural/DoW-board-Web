#!/usr/bin/env bash
# Lightsail 서버에서 실행: 새 이미지로 교체하고, 헬스체크에 실패하면 직전 이미지로 자동 롤백한다.
# 사용법: deploy.sh <이미지:태그> [기대 버전(커밋 sha)]
#   예) deploy.sh ghcr.io/me/dow:3f2a1bc 3f2a1bc...
# 상태 파일: $DOW_HOME/current, $DOW_HOME/previous, $DOW_HOME/deploys.log
# HTTPS : DOW_DOMAIN=도메인 을 주면(한 번 주면 $DOW_HOME/domain 에 기억) 앞에 Caddy 를 띄워
#         80·443 을 받고 인증서(Let's Encrypt)를 자동 발급·갱신한다. 앱은 127.0.0.1:3000 에만 연다.
set -euo pipefail

IMAGE="${1:?이미지:태그를 지정하세요}"
EXPECT="${2:-}"
DOW_HOME="${DOW_HOME:-/opt/dow}"
NAME=dow-app
NET=dow-net
PROXY=dow-caddy
HEALTH_TRIES=30
HEALTH_SLEEP=2

mkdir -p "$DOW_HOME/saves"
if [[ -n "${DOW_DOMAIN:-}" ]]; then echo "$DOW_DOMAIN" > "$DOW_HOME/domain"; fi
DOMAIN="$(cat "$DOW_HOME/domain" 2>/dev/null || true)"
if [[ -n "$DOMAIN" ]]; then
  HOST_PORT=3000; PUBLISH="127.0.0.1:${HOST_PORT}:3000"   # 밖에서는 Caddy 로만 들어온다
else
  HOST_PORT=80;   PUBLISH="${HOST_PORT}:3000"
fi
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/healthz"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$DOW_HOME/deploys.log"; }

run_image() { # $1=이미지
  local img="$1" sha="${1##*:}"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  docker run -d --name "$NAME" --restart unless-stopped \
    --network "$NET" -p "$PUBLISH" \
    -v "$DOW_HOME/saves:/app/saves" \
    -e GIT_SHA="$sha" \
    $( [[ -f "$DOW_HOME/env" ]] && echo "--env-file $DOW_HOME/env" ) \
    --stop-timeout 20 \
    "$img" >/dev/null
}

# HTTPS 프록시 : 도메인이 있으면 Caddy 를 띄운다 (설정이 그대로이고 이미 돌고 있으면 그냥 둔다)
ensure_proxy() {
  [[ -z "$DOMAIN" ]] && { docker rm -f "$PROXY" >/dev/null 2>&1 || true; return 0; }
  local conf="$DOW_HOME/Caddyfile" want
  want="$DOMAIN {
	encode gzip
	reverse_proxy $NAME:3000
}"
  if [[ "$(cat "$conf" 2>/dev/null)" == "$want" &&
        "$(docker inspect -f '{{.State.Running}}' "$PROXY" 2>/dev/null)" == "true" ]]; then
    return 0
  fi
  printf '%s\n' "$want" > "$conf"
  log "HTTPS 프록시 시작: https://$DOMAIN"
  docker rm -f "$PROXY" >/dev/null 2>&1 || true
  docker run -d --name "$PROXY" --restart unless-stopped --network "$NET" \
    -p 80:80 -p 443:443 -p 443:443/udp \
    -v "$conf:/etc/caddy/Caddyfile:ro" \
    -v dow-caddy-data:/data -v dow-caddy-config:/config \
    caddy:2 >/dev/null
}

healthy() { # $1=기대 버전(없으면 응답만 확인)
  local want="$1" body
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    if body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)"; then
      if [[ -z "$want" || "$body" == *"\"version\":\"$want\""* ]]; then return 0; fi
    fi
    sleep "$HEALTH_SLEEP"
  done
  return 1
}

CURRENT="$(cat "$DOW_HOME/current" 2>/dev/null || true)"
log "배포 시작: $IMAGE (현재: ${CURRENT:-없음}${DOMAIN:+, 도메인: $DOMAIN})"

docker pull "$IMAGE" || docker image inspect "$IMAGE" >/dev/null   # 받지 못해도 이미 있는 이미지면 진행

# 1) 기존 컨테이너 정상 종료 → 진행 중인 방이 saves/rooms.json에 저장됨
docker stop "$NAME" >/dev/null 2>&1 || true

# 2) 새 버전 시작 (저장된 방 복원)
run_image "$IMAGE"

# 3) 헬스체크 (버전까지 확인) → 통과하면 HTTPS 프록시 확인
if healthy "${EXPECT:-${IMAGE##*:}}"; then
  ensure_proxy
  [[ -n "$CURRENT" && "$CURRENT" != "$IMAGE" ]] && echo "$CURRENT" > "$DOW_HOME/previous"
  echo "$IMAGE" > "$DOW_HOME/current"
  log "배포 성공: $IMAGE"
  # 오래된 이미지 정리 (현재·직전 것은 사용 중/보관이라 남음)
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

# 4) 실패 → 자동 롤백
log "헬스체크 실패: $IMAGE — 최근 로그:"
docker logs --tail 40 "$NAME" 2>&1 | sed 's/^/    /' | tee -a "$DOW_HOME/deploys.log" || true
if [[ -n "$CURRENT" ]]; then
  log "자동 롤백: $CURRENT"
  run_image "$CURRENT"
  if healthy ""; then ensure_proxy; log "롤백 완료: $CURRENT 로 복구됨"; else log "⚠ 롤백 후에도 헬스체크 실패 — 직접 확인 필요"; fi
else
  log "⚠ 되돌릴 이전 버전이 없습니다 (첫 배포)"
fi
exit 1
