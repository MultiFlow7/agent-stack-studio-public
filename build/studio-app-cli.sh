#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
contents_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)

if [ -z "${STUDIO_USER_DATA_PATH:-}" ] && [ -n "${HOME:-}" ]; then
  STUDIO_USER_DATA_PATH="$HOME/Library/Application Support/Agent Stack Studio"
  export STUDIO_USER_DATA_PATH
fi

STUDIO_CLI_LAUNCHER="$script_dir/studio" ELECTRON_RUN_AS_NODE=1 exec \
  "$contents_dir/MacOS/Agent Stack Studio" \
  "$contents_dir/Resources/app.asar.unpacked/dist/cli/studio.mjs" \
  "$@"
