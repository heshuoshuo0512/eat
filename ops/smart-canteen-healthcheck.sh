#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SMART_CANTEEN_APP_DIR:-/opt/smart-canteen}"
BACKUP_ROOT="${SMART_CANTEEN_BACKUP_ROOT:-/var/backups/smart-canteen}"
DISK_LIMIT="${SMART_CANTEEN_DISK_LIMIT_PERCENT:-85}"
BACKUP_MAX_AGE_HOURS="${SMART_CANTEEN_BACKUP_MAX_AGE_HOURS:-36}"
cd "$APP_DIR"

curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/health/ready >/dev/null
for service in postgres redis minio api nginx; do
  container="$(docker compose ps -q "$service")"
  [[ -n "$container" ]] || { echo "Missing container: $service" >&2; exit 1; }
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  [[ "$state" == healthy || "$state" == running ]] || { echo "Unhealthy service: $service ($state)" >&2; exit 1; }
done

disk_percent="$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
(( disk_percent < DISK_LIMIT )) || { echo "Root disk usage is ${disk_percent}%" >&2; exit 1; }

latest_backup="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
[[ -n "$latest_backup" ]] || { echo "No completed Smart Canteen backup found" >&2; exit 1; }
backup_age="$(( $(date +%s) - $(stat -c %Y "$latest_backup") ))"
(( backup_age <= BACKUP_MAX_AGE_HOURS * 3600 )) || { echo "Latest backup is older than ${BACKUP_MAX_AGE_HOURS} hours" >&2; exit 1; }

printf 'status=healthy disk_percent=%s backup=%s\n' "$disk_percent" "$latest_backup"
