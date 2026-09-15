#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DESTINATION:?BACKUP_DESTINATION is required}"
: "${BACKUP_ENCRYPTION_PASSWORD:?BACKUP_ENCRYPTION_PASSWORD is required}"

mkdir -p "$BACKUP_DESTINATION"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
dump_path="$BACKUP_DESTINATION/bj-burgers-$timestamp.dump"

pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$dump_path"
openssl enc -aes-256-cbc -salt -pbkdf2 -in "$dump_path" -out "$dump_path.enc" -pass env:BACKUP_ENCRYPTION_PASSWORD
rm -f -- "$dump_path"
find "$BACKUP_DESTINATION" -type f -name '*.dump.enc' -mtime +14 -delete
