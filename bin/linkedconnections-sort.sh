#!/usr/bin/env bash
set -euo pipefail
CURDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null && pwd)"
exec node "$CURDIR/linkedconnections-sort.js" "$@"
