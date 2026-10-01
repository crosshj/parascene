#!/usr/bin/env bash
set -euo pipefail

run_as_root() {
	if [[ "$EUID" -eq 0 ]]; then
		"$@"
	else
		sudo -n "$@"
	fi
}

install_nginx_config() {
	local app_dir="$1"
	local source_path="$app_dir/infra/nginx/parascene.conf"
	local enabled_path="/etc/nginx/sites-enabled/parascene"
	local target_path
	local backup_path

	if [[ ! -f "$source_path" ]]; then
		echo "Nginx configuration is missing from the deployment package: $source_path" >&2
		return 1
	fi
	if [[ ! -e "$enabled_path" ]]; then
		echo "Expected enabled Nginx site does not exist: $enabled_path" >&2
		return 1
	fi

	target_path="$(readlink -f "$enabled_path")"
	if [[ -z "$target_path" || ! -f "$target_path" ]]; then
		echo "Unable to resolve the active Nginx site target: $enabled_path" >&2
		return 1
	fi

	backup_path="$(mktemp /tmp/parascene-nginx.XXXXXX)"
	if ! run_as_root cp --preserve=mode,ownership,timestamps "$target_path" "$backup_path"; then
		echo "The deploy user cannot create an Nginx configuration backup with non-interactive sudo" >&2
		rm -f "$backup_path"
		return 1
	fi

	rollback_nginx() {
		echo "Restoring the previous Nginx configuration" >&2
		run_as_root install -o root -g root -m 644 "$backup_path" "$target_path"
		run_as_root nginx -t
		run_as_root systemctl reload nginx
	}

	if ! run_as_root install -o root -g root -m 644 "$source_path" "$target_path"; then
		echo "The deploy user needs non-interactive sudo permission to install the Nginx site" >&2
		run_as_root rm -f "$backup_path" || true
		return 1
	fi
	if ! run_as_root nginx -t; then
		rollback_nginx
		run_as_root rm -f "$backup_path"
		return 1
	fi
	if ! run_as_root systemctl reload nginx; then
		rollback_nginx
		run_as_root rm -f "$backup_path"
		return 1
	fi

	run_as_root rm -f "$backup_path"
}

# Remote mode runs on the VPS. It is invoked by the CI mode below after the
# script has been copied to the host.
if [[ "${1:-}" == "remote" ]]; then
	set -euo pipefail
	PACKAGE_PATH="${2:?Package path is required}"
	APP_DIR="${3:?App directory is required}"
	DEPLOY_ID="$(date -u +%Y%m%d%H%M%S)-$$"
	STAGING_DIR="${APP_DIR}.staging-${DEPLOY_ID}"
	cleanup_staging() {
		rm -rf -- "$STAGING_DIR"
	}
	trap cleanup_staging EXIT

	# Build from a fresh extraction so deleted files from older deployments,
	# including a stale client/vendor tree, cannot leak into the Docker context.
	install -d -m 755 "$STAGING_DIR"
	tar -xzf "$PACKAGE_PATH" -C "$STAGING_DIR"
	rm -f "$PACKAGE_PATH"
	docker build --tag parascene:vps "$STAGING_DIR"

	# Replace the on-disk deployment only after the new image builds successfully.
	find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf -- {} +
	cp -a "$STAGING_DIR"/. "$APP_DIR"/
	docker rm --force parascene 2>/dev/null || true
	docker run --detach \
		--name parascene \
		--restart unless-stopped \
		--env-file "$APP_DIR/.env" \
		--publish 127.0.0.1:3000:3000 \
		parascene:vps

	# Nginx is versioned with the app, but installed as a separate privileged
	# host concern. Validation and rollback happen before public health checks.
	install_nginx_config "$APP_DIR"

	# Verify the public nginx-to-Docker path. Keep retrying while the container starts.
	for attempt in {1..30}; do
		if curl --fail --silent --output /dev/null \
			--insecure \
			--resolve beta.parascene.com:443:127.0.0.1 \
			https://beta.parascene.com/ && \
		curl --fail --silent --output /dev/null \
			--insecure \
			--resolve cdn.parascene.com:443:127.0.0.1 \
			https://cdn.parascene.com/healthz; then
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
BUILD_DIR="$RUNNER_TEMP/vps-deploy-build"
REMOTE="$VPS_USER@$VPS_HOST"
SSH_OPTS=(-i "$SSH_DIR/id_ed25519" -o UserKnownHostsFile="$SSH_DIR/known_hosts" -o StrictHostKeyChecking=yes)

# Validate and build the exact deployment payload before creating credentials,
# contacting the VPS, or changing anything on the deployment host.
mkdir -p "$BUILD_DIR"
tar --exclude='.env' -czf "$PACKAGE_PATH" -C vps .
tar -xzf "$PACKAGE_PATH" -C "$BUILD_DIR"
docker build --tag parascene:vps-ci "$BUILD_DIR"

# Keep the private key and known-hosts file inside the runner's temporary area.
install -m 700 -d "$SSH_DIR"
printf '%s\n' "$VPS_SSH_KEY" > "$SSH_DIR/id_ed25519"
chmod 600 "$SSH_DIR/id_ed25519"
ssh-keyscan -H "$VPS_HOST" > "$SSH_DIR/known_hosts"

# Transfer the app package and this script separately. The script is needed on
# the host before the package has been extracted.
scp "${SSH_OPTS[@]}" "$PACKAGE_PATH" "$REMOTE:/tmp/vps.tar.gz"
scp "${SSH_OPTS[@]}" vps/scripts/deploy-from-ci.sh "$REMOTE:/tmp/deploy-vps.sh"

# Write runtime secrets directly to the VPS with restrictive permissions; they
# are passed to Docker through --env-file and are never put in the archive.
	printf '%s\n' \
	"SUPABASE_URL=$SUPABASE_URL" \
	"SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" \
	"SESSION_SECRET=$SESSION_SECRET" \
	"APP_VERSION=beta" \
	"BUILD_COMMIT=$GITHUB_SHA" \
	"BUILD_COMMIT_URL=https://github.com/crosshj/parascene/commit/$GITHUB_SHA" \
	"BUILD_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"ASSET_VERSION=$GITHUB_SHA" | \
ssh "${SSH_OPTS[@]}" "$REMOTE" 'set -euo pipefail; install -d -m 755 "$HOME/parascene-vps"; umask 077; cat > "$HOME/parascene-vps/.env"; chmod 600 "$HOME/parascene-vps/.env"'

# Start the remote deployment and remove the temporary script afterward.
ssh "${SSH_OPTS[@]}" "$REMOTE" 'bash /tmp/deploy-vps.sh remote /tmp/vps.tar.gz "$HOME/parascene-vps"; rm -f /tmp/deploy-vps.sh'
