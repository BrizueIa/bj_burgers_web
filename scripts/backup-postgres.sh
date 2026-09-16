#!/usr/bin/env bash
set -euo pipefail

# Run on the VPS host. Only the B&J database container is accessed.
: "${BACKUP_DESTINATION:?required: host staging directory}"
: "${BACKUP_ENCRYPTION_PASSWORD_FILE:?required: root-readable password file}"
: "${OCI_CONFIG_DIR:?required: OCI CLI config and API key directory}"
: "${OCI_NAMESPACE:?required}"
: "${OCI_BUCKET_NAME:?required}"
: "${OCI_CLI_IMAGE:?required: pin an OCI CLI image digest}"
: "${COMPOSE_PROJECT_NAME:?required: B&J Compose project name}"

umask 077
mkdir -p -- "$BACKUP_DESTINATION"
test -f "$BACKUP_ENCRYPTION_PASSWORD_FILE"
test -f "$OCI_CONFIG_DIR/config"
DB_CONTAINER="$(docker ps --quiet \
  --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  --filter 'label=com.docker.compose.service=db')"
test -n "$DB_CONTAINER"
test "$(printf '%s\n' "$DB_CONTAINER" | wc -l)" -eq 1
test "$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER")" = true

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_file="$(mktemp "$BACKUP_DESTINATION/bj-burgers-$timestamp-XXXXXX.dump.enc")"
complete=0
cleanup_incomplete() {
  if [ "$complete" -eq 0 ]; then rm -f -- "$backup_file"; fi
}
trap cleanup_incomplete EXIT

# Encrypt the pg_dump stream immediately; plaintext is never written to disk.
docker exec "$DB_CONTAINER" pg_dump -U bj_burgers -d bj_burgers --format=custom --no-owner \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass "file:$BACKUP_ENCRYPTION_PASSWORD_FILE" -out "$backup_file"
test -s "$backup_file"
complete=1

object_name="$(basename "$backup_file")"
docker run --rm --user 0:0 \
  -e OCI_CLI_CONFIG_FILE=/oracle/.oci/config \
  -v "$OCI_CONFIG_DIR:/oracle/.oci:ro" \
  -v "$BACKUP_DESTINATION:/oracle/backup:ro" \
  "$OCI_CLI_IMAGE" os object put \
  --namespace-name "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_NAME" \
  --name "$object_name" --file "/oracle/backup/$object_name" --no-multipart

docker run --rm --user 0:0 \
  -e OCI_CLI_CONFIG_FILE=/oracle/.oci/config \
  -v "$OCI_CONFIG_DIR:/oracle/.oci:ro" \
  "$OCI_CLI_IMAGE" os object head \
  --namespace-name "$OCI_NAMESPACE" --bucket-name "$OCI_BUCKET_NAME" \
  --name "$object_name" >/dev/null

sha256sum "$backup_file"
rm -f -- "$backup_file"
echo "Backup verified in Object Storage: $object_name"
