#!/usr/bin/env bash
# Ежедневный бэкап Postgres с ротацией. Cron (root):
#   15 3 * * * /opt/crm-analytics/deploy/backup.sh >> /var/log/crm-backup.log 2>&1
# Восстановление:
#   gunzip -c crm-2026-10-26.sql.gz | docker compose -f deploy/docker-compose.prod.yml exec -T db psql -U crm -d crm
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/crm-analytics}
KEEP_DAYS=${KEEP_DAYS:-14}
COMPOSE="docker compose -f /opt/crm-analytics/deploy/docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/crm-$(date +%F).sql.gz"
tmp="$file.partial"

# --clean --if-exists: дамп можно накатывать на существующую базу; материализованные представления
# восстанавливаются вместе с данными, после восстановления их освежит ближайший синк.
$COMPOSE exec -T db pg_dump -U crm -d crm --no-owner --clean --if-exists | gzip -9 > "$tmp"
gzip -t "$tmp"
mv "$tmp" "$file"
find "$BACKUP_DIR" -name 'crm-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $file ($(du -h "$file" | cut -f1))"
