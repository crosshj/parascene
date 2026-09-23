#!/usr/bin/env bash
set -euo pipefail

# Remote mode runs on the VPS. It is invoked by the CI mode below after the
# script has been copied to the host.
if [[ "${1:-}" == "remote" ]]; then
	PACKAGE_PATH="${2:?Package path is required}"
	APP_DIR="${3:?App directory is required}"

	# Install the packaged app, build the image, and replace the running container.
	install -d -m 755 "$APP_DIR"
	tar -xzf "$PACKAGE_PATH" -C "$APP_DIR"
	rm -f "$PACKAGE_PATH"
	docker build --tag parascene:vps "$APP_DIR"
	docker rm --force parascene 2>/dev/null || true
	docker run --detach \
		--name parascene \
		--restart unless-stopped \
		--env-file "$APP_DIR/.env" \
		--publish 127.0.0.1:3000:3000 \
		parascene:vps

	# Verify the public nginx-to-Docker path. Keep retrying while the container starts.
	for attempt in {1..30}; do
		if curl --fail --silent --show-error --output /dev/null \
			--insecure https://localhost/ \
			-H 'Host: beta.parascene.com'; then
			exit 0
		fi
		sleep 2
	done
	docker ps -a --filter name=parascene
	docker logs --tail=200 parascene
	exit 1
fi

# CI mode runs on the GitHub Actions runner. It packages the VPS app, transfers
# the package and runtime secrets, then invokes this same script remotely.
: "${VPS_HOST:?VPS_HOST is required}"
: "${VPS_USER:?VPS_USER is required}"
: "${VPS_SSH_KEY:?VPS_SSH_KEY is required}"
: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${SESSION_SECRET:?SESSION_SECRET is required}"

SSH_DIR="$RUNNER_TEMP/vps-ssh"
PACKAGE_PATH="$RUNNER_TEMP/vps.tar.gz"
REMOTE="$VPS_USER@$VPS_HOST"
SSH_OPTS=(-i "$SSH_DIR/id_ed25519" -o UserKnownHostsFile="$SSH_DIR/known_hosts" -o StrictHostKeyChecking=yes)

# Keep the private key and known-hosts file inside the runner's temporary area.
install -m 700 -d "$SSH_DIR"
printf '%s\n' "$VPS_SSH_KEY" > "$SSH_DIR/id_ed25519"
chmod 600 "$SSH_DIR/id_ed25519"
ssh-keyscan -H "$VPS_HOST" > "$SSH_DIR/known_hosts"

# Never include a local .env in the deployment archive.
tar --exclude='.env' -czf "$PACKAGE_PATH" -C vps .

# Transfer the app package and this script separately. The script is needed on
# the host before the package has been extracted.
scp "${SSH_OPTS[@]}" "$PACKAGE_PATH" "$REMOTE:/tmp/vps.tar.gz"
scp "${SSH_OPTS[@]}" vps/scripts/deploy-from-ci.sh "$REMOTE:/tmp/deploy-vps.sh"

# Write runtime secrets directly to the VPS with restrictive permissions; they
# are passed to Docker through --env-file and are never put in the archive.
printf '%s\n' \
	"SUPABASE_URL=$SUPABASE_URL" \
	"SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" \
	"SESSION_SECRET=$SESSION_SECRET" | \
ssh "${SSH_OPTS[@]}" "$REMOTE" 'set -euo pipefail; install -d -m 755 "$HOME/parascene-vps"; umask 077; cat > "$HOME/parascene-vps/.env"; chmod 600 "$HOME/parascene-vps/.env"'

# Start the remote deployment and remove the temporary script afterward.
ssh "${SSH_OPTS[@]}" "$REMOTE" 'bash /tmp/deploy-vps.sh remote /tmp/vps.tar.gz "$HOME/parascene-vps"; rm -f /tmp/deploy-vps.sh'
