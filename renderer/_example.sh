#!/usr/bin/env bash

# This script is intended for use on a dedicated tile rendering server
# as the entry point for a cron job. It checks if a render is in progress,
# and if not, it clones the tileservice repo from GitHub and starts a render.

# The directory of the current script
DIR="$(dirname "$0")"

# The path of the lock file
LOCKFILE="/tmp/planet-render.lock"

# Check if lock file exists
if [ -e "${LOCKFILE}" ]; then
  echo "A rendering process is already running."
  exit 1
else
  # Create a lock file
  touch "${LOCKFILE}"

  # Ensure the lock file is removed when we exit and when we receive signals
  trap "rm -f ${LOCKFILE}; trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT
fi

# The local path to the tileservice repo
REPO_DIR="$DIR/tileservice"

rm -rf "$REPO_DIR"
mkdir "$REPO_DIR"

# Clone the default branch of the tileservice repo so we always use the latest scripts and layer definitions
git clone https://github.com/osmus/tileservice.git "$REPO_DIR"

# Start the render, assuming the directory format hasn't changed
"$REPO_DIR/renderer/render.sh"