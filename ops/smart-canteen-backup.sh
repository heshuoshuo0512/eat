#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SMART_CANTEEN_APP_DIR:-/opt/smart-canteen}"
BACKUP_ROOT="${SMART_CANTEEN_BACKUP_ROOT:-/var/backups/smart-canteen}"
RETENTION_DAYS="${SMART_CANTEEN_BACKUP_RETENTION_DAYS:-14}"

case "$BACKUP_ROOT" in
  /var/backups/smart-canteen|/var/backups/smart-canteen/*) ;;
  *) echo "Refusing backup root outside /var/backups/smart-canteen" >&2; exit 2 ;;
esac
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "Retention days must be numeric" >&2; exit 2; }
[[ -f "$APP_DIR/docker-compose.yml" && -f "$APP_DIR/.env" ]] || { echo "Smart Canteen deployment not found" >&2; exit 2; }

exec 9>/run/lock/smart-canteen-backup.lock
flock -n 9 || { echo "A Smart Canteen backup is already running" >&2; exit 1; }
umask 077
install -d -m 700 "$BACKUP_ROOT"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$BACKUP_ROOT/.${timestamp}.partial"
destination="$BACKUP_ROOT/$timestamp"
trap 'rm -rf -- "$staging"' EXIT
install -d -m 700 "$staging" "$staging/minio"
cd "$APP_DIR"

docker compose exec -T postgres sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$staging/postgres.dump"
docker compose exec -T postgres sh -ec 'pg_restore -l >/dev/null' < "$staging/postgres.dump"
docker compose exec -T api sh -ec 'tar -C /app/uploads -czf - .' > "$staging/uploads.tar.gz"

docker compose run --rm --no-deps -T \
  -v "$staging/minio:/backup" \
  --entrypoint sh minio-init -ec '
    if [ -n "${S3_BUCKET:-}" ]; then
      mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
      mc mirror --overwrite "source/$S3_BUCKET" /backup >/dev/null
    fi
  '

(
  cd "$staging"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
mv -- "$staging" "$destination"
trap - EXIT

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
printf 'backup=%s bytes=%s retention_days=%s\n' "$destination" "$(du -sb "$destination" | awk '{print $1}')" "$RETENTION_DAYS"
