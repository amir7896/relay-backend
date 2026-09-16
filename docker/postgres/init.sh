#!/bin/bash
set -euo pipefail

# POSTGRES_DB is the auth database, created by the official image.
# This script creates extra service databases on first volume init.
create_db_if_needed() {
  local name="$1"
  if [ -n "${name}" ] && [ "${name}" != "${POSTGRES_DB}" ]; then
    psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
      -c "CREATE DATABASE ${name};"
  fi
}

create_db_if_needed "${USER_POSTGRES_DATABASE:-}"
create_db_if_needed "${CHAT_POSTGRES_DATABASE:-}"
# Monolith node-backend database (single DB, independent of Nest services)
create_db_if_needed "${POSTGRES_DATABASE:-relay}"
