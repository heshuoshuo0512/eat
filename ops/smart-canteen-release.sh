#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SMART_CANTEEN_APP_DIR:-/opt/smart-canteen}"
STATE_ROOT="${SMART_CANTEEN_RELEASE_ROOT:-/var/lib/smart-canteen/releases}"
BACKUP_COMMAND="${SMART_CANTEEN_BACKUP_COMMAND:-/usr/local/sbin/smart-canteen-backup}"
target="${1:-}"
[[ "$target" =~ ^[a-f0-9]{7,40}$ ]] || { echo "Usage: smart-canteen-release <git-commit>" >&2; exit 2; }
[[ -f "$APP_DIR/docker-compose.yml" && -f "$APP_DIR/.env" ]] || { echo "Smart Canteen deployment not found" >&2; exit 2; }

exec 9>/run/lock/smart-canteen-release.lock
flock -n 9 || { echo "A Smart Canteen release is already running" >&2; exit 1; }
umask 077
install -d -m 700 "$STATE_ROOT"
cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] || { echo "Production checkout is dirty" >&2; exit 1; }

git fetch --quiet origin main
git cat-file -e "$target^{commit}"
git merge-base --is-ancestor "$target" origin/main || { echo "Target must be reachable from origin/main" >&2; exit 1; }
previous="$(git rev-parse HEAD)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_dir="$STATE_ROOT/$timestamp-$target"
next_dist="$APP_DIR/.dist-next-$timestamp"
previous_dist="$APP_DIR/.dist-previous-$timestamp"
rollback_image="smart-canteen-api:rollback-$timestamp"
image_saved=0
dist_switched=0

rollback() {
  exit_code="$?"
  trap - ERR
  set +e
  echo "Release failed; restoring application revision $previous" >&2
  git switch --detach --quiet "$previous"
  if (( image_saved )); then docker tag "$rollback_image" smart-canteen-api:local; fi
  if (( dist_switched )); then
    if [[ -e "$APP_DIR/dist" ]]; then mv -- "$APP_DIR/dist" "$release_dir/dist.failed"; fi
    if [[ -e "$previous_dist" ]]; then mv -- "$previous_dist" "$APP_DIR/dist"; fi
  else
    rm -rf -- "$next_dist"
  fi
  docker compose up -d --no-build --no-deps --force-recreate api
  docker compose up -d --no-build --no-deps --force-recreate nginx
  exit "$exit_code"
}
trap rollback ERR

install -d -m 700 "$release_dir"
printf 'previous=%s\ntarget=%s\nstarted=%s\n' "$previous" "$target" "$timestamp" > "$release_dir/release.env"
"$BACKUP_COMMAND"
if docker image inspect smart-canteen-api:local >/dev/null 2>&1; then
  docker tag smart-canteen-api:local "$rollback_image"
  image_saved=1
fi

git switch --detach --quiet "$target"
grep -q 'pgvector/pgvector:pg16' docker-compose.yml
! grep -qE 'postgres:17|pgvector:pg17' docker-compose.yml
docker compose config --quiet
docker compose build api

rm -rf -- "$next_dist"
install -d -m 755 "$next_dist"
image_container="$(docker create smart-canteen-api:local)"
if ! docker cp "$image_container:/app/dist/." "$next_dist/"; then
  docker rm -f "$image_container" >/dev/null 2>&1 || true
  false
fi
docker rm "$image_container" >/dev/null
test -s "$next_dist/index.html"

docker compose up -d --no-build postgres redis minio
docker compose run --rm --no-deps -T db-roles
docker compose run --rm --no-deps -T db-migrate
docker compose run --rm --no-deps -T db-grants
docker compose run --rm --no-deps -T minio-init

mv -- "$APP_DIR/dist" "$previous_dist"
dist_switched=1
mv -- "$next_dist" "$APP_DIR/dist"
docker compose up -d --no-build --force-recreate api nginx

for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 5 http://127.0.0.1/api/health/ready >/dev/null; then break; fi
  sleep 2
done
curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/health/ready >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1/ >/dev/null

mv -- "$previous_dist" "$release_dir/dist.previous"
dist_switched=0
trap - ERR
printf 'completed=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" >> "$release_dir/release.env"
printf 'release=%s previous=%s target=%s\n' "$release_dir" "$previous" "$target"
