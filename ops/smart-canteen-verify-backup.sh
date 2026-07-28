#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SMART_CANTEEN_APP_DIR:-/opt/smart-canteen}"
BACKUP_ROOT="${SMART_CANTEEN_BACKUP_ROOT:-/var/backups/smart-canteen}"
cd "$APP_DIR"
latest="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
[[ -n "$latest" ]] || { echo "No completed Smart Canteen backup found" >&2; exit 1; }

(
  cd "$latest"
  sha256sum --check SHA256SUMS >/dev/null
)
tar -tzf "$latest/uploads.tar.gz" >/dev/null

restore_db="smart_canteen_restore_verify_$$"
cleanup() {
  docker compose exec -T postgres dropdb -U postgres --if-exists "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose exec -T postgres createdb -U postgres "$restore_db"
docker compose exec -T postgres pg_restore -U postgres --no-owner --no-privileges --exit-on-error -d "$restore_db" < "$latest/postgres.dump"
table_count="$(docker compose exec -T postgres psql -U postgres -d "$restore_db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
user_count="$(docker compose exec -T postgres psql -U postgres -d "$restore_db" -Atc 'SELECT count(*) FROM users')"
[[ "$table_count" =~ ^[1-9][0-9]*$ ]] || { echo "Restored database has no public tables" >&2; exit 1; }
cleanup
trap - EXIT
printf 'backup=%s restored_tables=%s restored_users=%s\n' "$latest" "$table_count" "$user_count"
