#!/usr/bin/env bash
set -euo pipefail
cd /opt/yt2x
git fetch --all
git reset --hard origin/main
/usr/bin/docker compose pull || true
/usr/bin/docker compose up -d --build
