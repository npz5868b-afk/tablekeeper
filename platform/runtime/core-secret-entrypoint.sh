#!/bin/sh
set -eu
if [ "${TK_DATABASE_URL_FILE:-}" = "" ] || [ ! -f "$TK_DATABASE_URL_FILE" ]; then
  echo "TK_DATABASE_URL_FILE is missing or unreadable" >&2
  exit 78
fi
TK_DATABASE_URL="$(cat "$TK_DATABASE_URL_FILE")"
export TK_DATABASE_URL
exec "$@"
