#!/usr/bin/env bash
# Пересобрать scratch-базу из SQL-файлов (быстрая проверка DDL/PLpgSQL без Alembic).
set -euo pipefail
cd "$(dirname "$0")/../.."
docker exec bondrisk-db psql -U postgres -d postgres -qc "drop database if exists scratch" -c "create database scratch" >/dev/null
docker exec bondrisk-db psql -U postgres -d scratch -qc "create extension timescaledb; create extension btree_gist; create schema ref; create schema ops; create schema ts; create schema risk; create schema audit; create schema stg;" >/dev/null
for f in db/schema/0001_initial.sql db/schema/0002_floaters_offers.sql db/schema/0003_hypertables.sql db/seed/0001_static.sql db/functions/*.sql db/triggers/*.sql db/views/*.sql; do
  docker exec -i bondrisk-db psql -U postgres -d scratch -v ON_ERROR_STOP=1 -q < "$f" 2>&1 | grep -vE '^(NOTICE|$| create_hypertable| -+| \(1,t\)| \([0-9]+ rows?\))' || true
done
echo "scratch rebuilt"
