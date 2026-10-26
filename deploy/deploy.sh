#!/usr/bin/env bash
# Безопасная выкатка на VPS: сборка образа с тегом коммита -> миграции -> перезапуск -> healthcheck -> откат при неудаче.
#   ./deploy/deploy.sh [git-ref]   (по умолчанию origin/main)
# Миграции пишутся обратно совместимыми (expand/contract): старая версия приложения работает на новой схеме,
# поэтому откат - это просто запуск предыдущего образа.
set -euo pipefail
cd "$(dirname "$0")/.."

REF=${1:-origin/main}
ENV_FILE=${ENV_FILE:-/etc/crm-analytics.env}
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file $ENV_FILE"
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/api/health}

git fetch --quiet origin
git checkout --quiet --detach "$REF"
SHA=$(git rev-parse --short HEAD)
PREV_IMAGE=$($COMPOSE ps --format '{{.Image}}' app 2>/dev/null || true)
NEW_IMAGE="crm-analytics:$SHA"

echo "==> build $NEW_IMAGE (previous: ${PREV_IMAGE:-none})"
docker build --pull -t "$NEW_IMAGE" .

echo "==> migrations"
APP_IMAGE=$NEW_IMAGE $COMPOSE run --rm --no-deps app node dist/db/migrate-cli.js

echo "==> restart"
APP_IMAGE=$NEW_IMAGE $COMPOSE up -d app

for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" > /dev/null; then
    echo "==> healthy: $NEW_IMAGE"
    exit 0
  fi
  sleep 2
done

echo "!!> healthcheck failed, rolling back to ${PREV_IMAGE:-<none>}" >&2
if [ -n "$PREV_IMAGE" ]; then
  APP_IMAGE=$PREV_IMAGE $COMPOSE up -d app
fi
exit 1
