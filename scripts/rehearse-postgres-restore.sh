#!/usr/bin/env bash
set -euo pipefail

: "${POS_REHEARSAL_SOURCE_URL:?Use an isolated PostgreSQL test database URL}"
: "${POS_REHEARSAL_ARTIFACT_DIR:?Set a temporary directory for the rehearsal output}"
restore_database="bj_pos_restore_rehearsal_${RANDOM}_$$"

node --input-type=module <<'NODE'
const source = new URL(process.env.POS_REHEARSAL_SOURCE_URL);
const databaseName = decodeURIComponent(source.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(source.hostname) || !databaseName.endsWith('_test')) {
  throw new Error('The rehearsal may only run against a local database whose name ends in _test.');
}
if (source.search || source.hash) {
  throw new Error('Do not include query parameters or fragments in the rehearsal database URL.');
}
NODE

command -v docker >/dev/null || { echo 'Docker is required for the PostgreSQL 17 client image.' >&2; exit 1; }
mkdir -p -- "$POS_REHEARSAL_ARTIFACT_DIR"
artifact_dir="$(cd "$POS_REHEARSAL_ARTIFACT_DIR" && pwd)"
restore_url="${POS_REHEARSAL_SOURCE_URL%/*}/${restore_database}"

docker run --rm --network host \
  --volume "$artifact_dir:/rehearsal" \
  --env POS_REHEARSAL_SOURCE_URL \
  --env POS_REHEARSAL_RESTORE_URL="$restore_url" \
  --env POS_REHEARSAL_RESTORE_DATABASE="$restore_database" \
  postgres:17-alpine sh -euc '
    pg_dump --format=custom --no-owner \
      --dbname="$POS_REHEARSAL_SOURCE_URL" \
      --file=/rehearsal/bj-pos-rehearsal.dump
    test -s /rehearsal/bj-pos-rehearsal.dump
    pg_restore --list /rehearsal/bj-pos-rehearsal.dump \
      > /rehearsal/archive-contents.txt
    test -s /rehearsal/archive-contents.txt

    createdb --maintenance-db="$POS_REHEARSAL_SOURCE_URL" --template=template0 \
      "$POS_REHEARSAL_RESTORE_DATABASE"
    trap '\''dropdb --if-exists --maintenance-db="$POS_REHEARSAL_SOURCE_URL" "$POS_REHEARSAL_RESTORE_DATABASE" >/dev/null 2>&1 || true'\'' EXIT
    pg_restore --exit-on-error --no-owner \
      --dbname="$POS_REHEARSAL_RESTORE_URL" \
      /rehearsal/bj-pos-rehearsal.dump

    psql "$POS_REHEARSAL_SOURCE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -f /rehearsal/postgres-restore-row-counts.sql \
      > /rehearsal/source-row-counts.txt
    psql "$POS_REHEARSAL_RESTORE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
      -f /rehearsal/postgres-restore-row-counts.sql \
      > /rehearsal/restored-row-counts.txt
    diff -u /rehearsal/source-row-counts.txt /rehearsal/restored-row-counts.txt
    echo "PostgreSQL 17 backup and restore matched all public table counts and POS balance totals."
  '
