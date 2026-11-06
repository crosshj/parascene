#!/usr/bin/env bash
# Used by nodemon: start the API server immediately; build chat/assets in the background
# so restarts are not blocked by rollup / chat bundle CSS. Stops the bundle subshell on shell exit.

set -uo pipefail

SERVER_ENTRY="${1:?usage: nodemon-server-first.sh <path-to-server-js>}"

run_bundle() {
	( node scripts/check-rollup-devdeps.mjs && npx rollup -c src/rollup.config.mjs ) || true
	node scripts/build-chat-bundle-css.mjs
}

run_bundle &
BUNDLE_PID=$!

cleanup_bundle() {
	if kill -0 "$BUNDLE_PID" 2>/dev/null; then
		kill "$BUNDLE_PID" 2>/dev/null || true
		wait "$BUNDLE_PID" 2>/dev/null || true
	fi
}

trap cleanup_bundle EXIT

node "$SERVER_ENTRY"
