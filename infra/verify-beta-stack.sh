#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/compose.beta.yaml"
PROJECT_NAME="${BETA_VERIFY_PROJECT:-codearchive-beta-verify}"
ENV_FILE="${BETA_ENV_FILE:-}"
SENTINEL_ID="00000000-0000-0000-0000-000000000037"
SENTINEL_GITHUB_ID="-370037"

compose() {
  if [[ -n "$ENV_FILE" ]]; then
    docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  fi
}

cleanup() {
  if [[ "${KEEP_BETA_STACK:-0}" != "1" ]]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

# Validate without printing interpolated environment values.
compose config --quiet

# Use an isolated project/volume so this verification cannot remove another stack.
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up --detach --build --wait --wait-timeout 240 postgres analysis api

# Main API health inside its own container.
compose exec -T api bash -ec '
  exec 3<>/dev/tcp/127.0.0.1/8080
  printf "GET /actuator/health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3
  grep -q "\"status\":\"UP\"" <&3
'

# Analysis health through the private service network from the Main API container.
compose exec -T api bash -ec '
  exec 3<>/dev/tcp/analysis/8000
  printf "GET /health HTTP/1.0\r\nHost: analysis\r\n\r\n" >&3
  grep -q "\"status\":\"UP\"" <&3
'

# Insert a local-only persistence sentinel after Flyway has created the durable schema.
compose exec -T postgres sh -ec "
  PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql \
    -h 127.0.0.1 \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -v ON_ERROR_STOP=1 \
    -c \"INSERT INTO users (id, github_user_id, github_login, created_at, updated_at)
        VALUES ('$SENTINEL_ID', $SENTINEL_GITHUB_ID, 'beta-persistence-probe', now(), now())
        ON CONFLICT (github_user_id) DO UPDATE SET updated_at = excluded.updated_at;\" \
    >/dev/null
"

before_count="$(compose exec -T postgres sh -ec "
  PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql \
    -h 127.0.0.1 \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -Atqc \"SELECT count(*) FROM users WHERE github_user_id = $SENTINEL_GITHUB_ID;\"
" | tr -d '\r')"

if [[ "$before_count" != "1" ]]; then
  echo "persistence sentinel was not created" >&2
  exit 1
fi

# Restart only application services. PostgreSQL and its named volume stay running.
compose restart api analysis >/dev/null
compose up --detach --wait --wait-timeout 180 api analysis >/dev/null

after_count="$(compose exec -T postgres sh -ec "
  PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql \
    -h 127.0.0.1 \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -Atqc \"SELECT count(*) FROM users WHERE github_user_id = $SENTINEL_GITHUB_ID;\"
" | tr -d '\r')"

if [[ "$after_count" != "1" ]]; then
  echo "PostgreSQL data did not survive app-service restart" >&2
  exit 1
fi

# Re-check both health boundaries after restart.
compose exec -T api bash -ec '
  exec 3<>/dev/tcp/127.0.0.1/8080
  printf "GET /actuator/health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3
  grep -q "\"status\":\"UP\"" <&3
'
compose exec -T api bash -ec '
  exec 3<>/dev/tcp/analysis/8000
  printf "GET /health HTTP/1.0\r\nHost: analysis\r\n\r\n" >&3
  grep -q "\"status\":\"UP\"" <&3
'

# Remove only the verification row; the persistence assertion already completed.
compose exec -T postgres sh -ec "
  PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql \
    -h 127.0.0.1 \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -v ON_ERROR_STOP=1 \
    -c \"DELETE FROM users WHERE github_user_id = $SENTINEL_GITHUB_ID;\" \
    >/dev/null
"

echo "beta compose config: PASS"
echo "main api health: PASS"
echo "analysis private-network health: PASS"
echo "postgres data after api/analysis restart: PASS"
