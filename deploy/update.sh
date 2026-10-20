#!/usr/bin/env bash
# Pulls the latest main and restarts Butler. The GitHub deploy key can run
# only this script (see "Automatic deploys" in the README).
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin main
git reset --quiet --hard origin/main   # settings and data are git-ignored, so they stay
cd deploy
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "Butler is running $(git rev-parse --short HEAD)"
