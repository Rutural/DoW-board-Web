#!/usr/bin/env bash
# Lightsail 서버에서 실행: 직전 버전(또는 지정한 이미지)으로 되돌린다.
# 사용법: rollback.sh            → $DOW_HOME/previous 로
#         rollback.sh <이미지:태그> → 그 이미지로
set -euo pipefail
DOW_HOME="${DOW_HOME:-/opt/dow}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TARGET="${1:-$(cat "$DOW_HOME/previous" 2>/dev/null || true)}"
CURRENT="$(cat "$DOW_HOME/current" 2>/dev/null || true)"
if [[ -z "$TARGET" ]]; then echo "되돌릴 이전 버전이 없습니다." >&2; exit 1; fi
if [[ "$TARGET" == "$CURRENT" ]]; then echo "이미 $TARGET 버전입니다." >&2; exit 0; fi

echo "[$(date -u +%FT%TZ)] 수동 롤백 요청: $CURRENT → $TARGET" | tee -a "$DOW_HOME/deploys.log"
# 배포 스크립트를 그대로 써서 헬스체크·실패 시 복구까지 동일하게 처리
bash "$HERE/deploy.sh" "$TARGET"
