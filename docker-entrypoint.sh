#!/bin/sh
set -e

# A mounted volume arrives owned by root, while the app runs unprivileged — so
# Prisma cannot create the database file and the container dies on boot with
# "unable to open database file". Fix the ownership as root, then drop
# privileges before running anything else.
#
# This only matters for the directory the volume is mounted at, derived from
# DATABASE_URL so the two cannot drift apart.
if [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    file:/*)
      DB_PATH=$(printf '%s' "$DATABASE_URL" | sed 's|^file:||')
      DB_DIR=$(dirname "$DB_PATH")
      mkdir -p "$DB_DIR"
      chown -R app:app "$DB_DIR"
      ;;
  esac
fi

# su-exec replaces this shell, so the app is PID 1 and receives signals.
exec su-exec app "$@"
