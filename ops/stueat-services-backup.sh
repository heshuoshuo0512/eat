#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${STUEAT_SERVICES_BACKUP_ROOT:-/var/backups/stueat-services}"
RETENTION_DAYS="${STUEAT_SERVICES_BACKUP_RETENTION_DAYS:-14}"
ASTRBOT_DIR="${ASTRBOT_DIR:-/opt/astrbot-napcat}"
SUB2API_DIR="${SUB2API_DIR:-/opt/sub2api}"
SUB2API_PROJECT="${SUB2API_PROJECT:-sub2api-restored}"
SUB2API_ENV="${SUB2API_ENV:-deploy/.env.local}"
SUB2API_COMPOSE_LOCAL="${SUB2API_COMPOSE_LOCAL:-deploy/docker-compose.local-secure.yml}"
SUB2API_COMPOSE_PRIVATE="${SUB2API_COMPOSE_PRIVATE:-deploy/docker-compose.server-private.yml}"
SUB2API_DATA_VOLUME="${SUB2API_DATA_VOLUME:-sub2api-restored_sub2api_data}"

case "$BACKUP_ROOT" in
  /var/backups/stueat-services|/var/backups/stueat-services/*) ;;
  *) echo "Refusing backup root outside /var/backups/stueat-services" >&2; exit 2 ;;
esac
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "Retention days must be numeric" >&2; exit 2; }
[[ -d "$ASTRBOT_DIR" && -f "$SUB2API_DIR/$SUB2API_ENV" ]] || { echo "Private service deployment not found" >&2; exit 2; }

exec 9>/run/lock/stueat-services-backup.lock
flock -n 9 || { echo "A private service backup is already running" >&2; exit 1; }
umask 077
install -d -m 700 "$BACKUP_ROOT"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$BACKUP_ROOT/.${timestamp}.partial"
destination="$BACKUP_ROOT/$timestamp"
trap 'rm -rf -- "$staging"' EXIT
install -d -m 700 "$staging"

tar -C "$ASTRBOT_DIR" -czf "$staging/astrbot-napcat.tar.gz" .

cd "$SUB2API_DIR"
docker compose --env-file "$SUB2API_ENV" -p "$SUB2API_PROJECT" \
  -f "$SUB2API_COMPOSE_LOCAL" -f "$SUB2API_COMPOSE_PRIVATE" \
  exec -T postgres sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$staging/sub2api-postgres.dump"

docker run --rm \
  -v "$SUB2API_DATA_VOLUME:/data:ro" \
  -v "$staging:/backup" \
  postgres:18-alpine sh -ec 'tar -C /data -czf /backup/sub2api-data.tar.gz .'

tar -C "$SUB2API_DIR" -czf "$staging/sub2api-config.tar.gz" \
  "$SUB2API_ENV" \
  deploy/docker-compose.local-secure.yml \
  deploy/docker-compose.server-private.yml \
  deploy/secrets/account-credential-keyring.json

printf 'created=%s\nastrobot_dir=%s\nsub2api_dir=%s\n' "$timestamp" "$ASTRBOT_DIR" "$SUB2API_DIR" > "$staging/manifest.txt"
(
  cd "$staging"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)
mv -- "$staging" "$destination"
trap - EXIT

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
printf 'backup=%s bytes=%s retention_days=%s\n' "$destination" "$(du -sb "$destination" | awk '{print $1}')" "$RETENTION_DAYS"
