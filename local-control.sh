#!/usr/bin/env bash
set -euo pipefail

# Jump to repo root no matter where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If we're in a subfolder (e.g., scripts/), hop to the git top-level
if command -v git >/dev/null 2>&1 && git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
else
  REPO_ROOT="$SCRIPT_DIR"
fi
cd "$REPO_ROOT"

COMPOSE="docker compose"

wait_for_docker() {
  for i in {1..30}; do
    if docker info >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Docker engine not ready after ~60s" >&2
  return 1
}

usage() {
  cat <<USAGE
Usage: $0 {start|stop|restart|status|logs|force-check|rebuild|env}
  start        Build (if needed) and start the watcher in background
  stop         Stop the watcher
  restart      Restart the watcher
  status       Show compose status
  logs         Follow logs
  force-check  Clear last seen video so the watcher re-checks immediately
  rebuild      Force rebuild image and restart
  env          Print key env values currently in use
USAGE
}

cmd=${1:-help}

case "$cmd" in
  start)
    wait_for_docker
    $COMPOSE up -d --build
    $COMPOSE ps
    ;;
  stop)
    $COMPOSE down
    ;;
  restart)
    wait_for_docker
    $COMPOSE up -d --build
    ;;
  status)
    $COMPOSE ps
    ;;
  logs)
    $COMPOSE logs -f
    ;;
  force-check)
    $COMPOSE exec yt2x rm -f /var/lib/yt2x/last.txt || true
    echo "Cleared state; watcher will process the latest feed item on next poll."
    ;;
  rebuild)
    wait_for_docker
    $COMPOSE build --no-cache
    $COMPOSE up -d
    ;;
  env)
    # print select env values without secrets
    if [ -f ".env" ]; then
      grep -E '^(FEED_URL|TEASER_SECONDS|POLL_SECONDS|MAX_RETRIES|RETRY_DELAY_S|DRY_RUN|X_EXPECTED_USERNAME|SKIP_IDENTITY_CHECK)=' .env || true
    else
      echo ".env not found"
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
