#!/usr/bin/env bash
# Applique les migrations sur une base Postgres locale jetable puis lance les tests SQL.
# Prérequis : Postgres 16 + PostGIS + pg_trgm + unaccent, et un accès superutilisateur.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-manifeste_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f "$DIR/tests/stubs.sql"
for f in "$DIR"/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f"
done
"${PSQL[@]}" -d "$DB" -f "$DIR/seed.sql"
for f in "$DIR"/tests/*.test.sql; do
  echo "== $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done
echo "OK"
