#!/usr/bin/env bash
set -euo pipefail

run_as_root() {
	if [[ "$EUID" -eq 0 ]]; then
		"$@"
	else
		sudo -n "$@"
	fi
}

deploy_target() {
	case "$DEPLOY_ENV" in
		beta)
			APP_HOME_NAME="parascene-vps"
			CONTAINER_NAME="parascene"
			HOST_PORT="3000"
			IMAGE_TAG="parascene:beta"
			APP_ORIGIN="https://beta.parascene.com"
			API_HOSTNAME="api.parascene.com"
			API_TEST_HOSTNAME="beta-api.parascene.com"
			CDN_HOSTNAME="cdn.parascene.com"
			CDN_TEST_HOSTNAME="beta-cdn.parascene.com"
			SHARE_TEST_HOSTNAME="beta-sh.parascene.com"
			# Beta-prefixed hosts are manual test aliases and are never emitted.
			NGINX_SERVER_NAMES="__SITE_BETA_TEST_HOSTS__"
			;;
		prod)
			# Same VPS, prod container. WWW is canonical; apex is a redirect alias.
			# Share is live here; API remains on Vercel until its later cutover.
			APP_HOME_NAME="parascene-prod"
			CONTAINER_NAME="parascene-prod"
			HOST_PORT="3001"
			IMAGE_TAG="parascene:prod"
			APP_ORIGIN="https://www.parascene.com"
			API_HOSTNAME="api.parascene.com"
			API_TEST_HOSTNAME=""
			CDN_HOSTNAME="cdn.parascene.com"
			CDN_TEST_HOSTNAME=""
			SHARE_TEST_HOSTNAME=""
			NGINX_SERVER_NAMES="__SITE_CDN_SHARE__"
			;;
		*)
			echo "DEPLOY_ENV must be beta or prod (got: ${DEPLOY_ENV:-})" >&2
			return 1
			;;
	esac
	# Both VPS sites hand creation execution to the existing Vercel API worker.
	CREATION_JOB_MODE="qstash"
	CREATION_WORKER_ORIGIN="https://api.parascene.com"
	SITE_HOST="${APP_ORIGIN#https://}"
	SITE_HOST="${SITE_HOST#http://}"
	SITE_HOST="${SITE_HOST%%/*}"
}

render_nginx_config() {
	local app_dir="$1"
	local source_path="$app_dir/infra/nginx/parascene.conf"
	local rendered_path="$app_dir/infra/nginx/parascene-${DEPLOY_ENV}.conf"
	local server_names

	case "${NGINX_SERVER_NAMES:-}" in
		__SITE_ONLY__)
			server_names="$SITE_HOST"
			;;
		__SITE_AND_CDN__)
			server_names="${SITE_HOST} ${CDN_HOSTNAME}"
			;;
		__SITE_CDN_SHARE__)
			server_names="${SITE_HOST} ${CDN_HOSTNAME} sh.parascene.com"
			;;
		__SITE_API_CDN__|"")
			server_names="${SITE_HOST} ${API_HOSTNAME} ${CDN_HOSTNAME}"
			;;
		__SITE_API__)
			server_names="${SITE_HOST} ${API_HOSTNAME}"
			;;
		__SITE_BETA_TEST_HOSTS__)
			server_names="${SITE_HOST} ${API_TEST_HOSTNAME} ${CDN_TEST_HOSTNAME} ${SHARE_TEST_HOSTNAME}"
			;;
		*)
			server_names="$NGINX_SERVER_NAMES"
			;;
	esac

	if [[ ! -f "$source_path" ]]; then
		echo "Nginx configuration is missing from the deployment package: $source_path" >&2
		return 1
	fi
	sed \
		-e "s/__SERVER_NAMES__/${server_names}/g" \
		-e "s/__HOST_PORT__/${HOST_PORT}/g" \
		"$source_path" > "$rendered_path"
	if [[ "$DEPLOY_ENV" == "prod" ]]; then
		local apex_path="$app_dir/infra/nginx/apex-redirect.conf"
		if [[ ! -f "$apex_path" ]]; then
			echo "Production apex redirect configuration is missing: $apex_path" >&2
			return 1
		fi
		cat "$apex_path" >> "$rendered_path"
	fi
	printf '%s\n' "$rendered_path"
}

provision_tls_certificate() {
	local credentials=/etc/letsencrypt/cloudflare.ini
	if ! run_as_root test -s "$credentials"; then
		echo "Cloudflare DNS credentials are missing at $credentials" >&2
		return 1
	fi
	run_as_root chmod 600 "$credentials"
	if ! command -v certbot >/dev/null || ! run_as_root certbot plugins --text 2>/dev/null | grep -q 'dns-cloudflare'; then
		if ! command -v apt-get >/dev/null; then
			echo "Certbot DNS Cloudflare requires a Debian/Ubuntu VPS with apt-get" >&2
			return 1
		fi
		run_as_root apt-get update
		run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-dns-cloudflare
	fi
	run_as_root certbot certonly \
		--dns-cloudflare \
		--dns-cloudflare-credentials "$credentials" \
		--dns-cloudflare-propagation-seconds 30 \
		--non-interactive --agree-tos --register-unsafely-without-email \
		--cert-name parascene.com \
		-d parascene.com -d '*.parascene.com'
	run_as_root install -d -o root -g root -m 755 /etc/letsencrypt/renewal-hooks/deploy
	run_as_root sh -c 'printf "%s\n" "#!/bin/sh" "systemctl reload nginx" > /etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx'
	run_as_root chmod 755 /etc/letsencrypt/renewal-hooks/deploy/10-reload-nginx
	run_as_root systemctl enable --now certbot.timer
	for host in parascene.com beta.parascene.com beta-api.parascene.com beta-cdn.parascene.com beta-sh.parascene.com www.parascene.com cdn.parascene.com sh.parascene.com; do
		if ! run_as_root openssl x509 -in /etc/letsencrypt/live/parascene.com/fullchain.pem -noout -checkhost "$host" >/dev/null 2>&1; then
			echo "The managed TLS certificate does not cover $host" >&2
			return 1
		fi
	done
}

install_nginx_config() {
	local rendered_path="$1"
	local site_name="parascene-${DEPLOY_ENV}"
	local available_path="/etc/nginx/sites-available/${site_name}"
	local enabled_path="/etc/nginx/sites-enabled/${site_name}"
	local legacy_path="/etc/nginx/sites-enabled/parascene"
	local other_site
	local backup_path
	local previous_backup=""
	local legacy_backup=""

	# Each deploy owns exactly one site file. Never install/remove the other slot.
	if [[ "$DEPLOY_ENV" == "beta" ]]; then
		other_site="parascene-prod"
	else
		other_site="parascene-beta"
	fi
	if [[ "$site_name" == "$other_site" ]]; then
		echo "refusing to install nginx site ${site_name} during ${DEPLOY_ENV} deploy" >&2
		return 1
	fi
	if [[ "$DEPLOY_ENV" == "beta" && -e "$legacy_path" && -e /etc/nginx/sites-enabled/parascene-prod ]]; then
		echo "refusing to remove the legacy Nginx site during beta deploy while the prod site is enabled" >&2
		return 1
	fi

	if [[ "$DEPLOY_ENV" == "prod" && ! -e /etc/nginx/sites-enabled/parascene-beta && -e "$legacy_path" ]]; then
		echo "Deploy beta before the first prod deploy so the combined Nginx site can be replaced without dropping beta.parascene.com" >&2
		return 1
	fi

	backup_path="$(mktemp /tmp/parascene-nginx.XXXXXX)"
	if ! run_as_root cp --preserve=mode,ownership,timestamps "$rendered_path" "$backup_path"; then
		echo "The deploy user cannot stage the Nginx site with non-interactive sudo" >&2
		rm -f "$backup_path"
		return 1
	fi
	if [[ -f "$available_path" ]]; then
		previous_backup="$(mktemp /tmp/parascene-nginx-previous.XXXXXX)"
		if ! run_as_root cp --preserve=mode,ownership,timestamps "$available_path" "$previous_backup"; then
			echo "The deploy user cannot back up the existing Nginx site" >&2
			rm -f "$backup_path" "$previous_backup"
			return 1
		fi
	fi

	rollback_nginx() {
		echo "Restoring the previous Nginx configuration" >&2
		if [[ -n "$previous_backup" && -f "$previous_backup" ]]; then
			run_as_root install -o root -g root -m 644 "$previous_backup" "$available_path"
			run_as_root ln -sfn "$available_path" "$enabled_path"
		else
			run_as_root rm -f "$enabled_path" "$available_path"
		fi
		if [[ -n "$legacy_backup" && -f "$legacy_backup" ]]; then
			run_as_root install -o root -g root -m 644 "$legacy_backup" "$legacy_path"
		fi
		run_as_root nginx -t
		run_as_root systemctl reload nginx
	}

	# The previous single site served beta and cdn together. Each environment
	# now owns its own site file, so that combined file has to leave before
	# nginx will accept the split server names.
	if [[ -e "$legacy_path" ]]; then
		legacy_backup="$(mktemp /tmp/parascene-nginx-legacy.XXXXXX)"
		if ! run_as_root cp --preserve=mode,ownership,timestamps "$legacy_path" "$legacy_backup"; then
			echo "The deploy user cannot back up the legacy Nginx site" >&2
			rm -f "$backup_path" "$legacy_backup"
			return 1
		fi
		run_as_root rm -f "$legacy_path"
	fi

	if ! run_as_root install -o root -g root -m 644 "$backup_path" "$available_path"; then
		echo "The deploy user needs non-interactive sudo permission to install the Nginx site" >&2
		rollback_nginx
		rm -f "$backup_path"
		return 1
	fi
	if ! run_as_root ln -sfn "$available_path" "$enabled_path"; then
		rollback_nginx
		rm -f "$backup_path"
		return 1
	fi
	if ! run_as_root nginx -t; then
		rollback_nginx
		rm -f "$backup_path"
		return 1
	fi
	if ! run_as_root systemctl reload nginx; then
		rollback_nginx
		rm -f "$backup_path"
		return 1
	fi

	rm -f "$backup_path"
	[[ -n "$previous_backup" ]] && run_as_root rm -f "$previous_backup" || true
	[[ -n "$legacy_backup" ]] && run_as_root rm -f "$legacy_backup" || true
}

https_status() {
	local host="$1"
	local path="$2"
	curl --silent --output /dev/null --write-out '%{http_code}' \
		--resolve "${host}:443:127.0.0.1" \
		"https://${host}${path}" || true
}

https_ok() {
	local host="$1"
	local path="$2"
	curl --fail --silent --output /dev/null \
		--resolve "${host}:443:127.0.0.1" \
		"https://${host}${path}"
}

# Remote mode runs on the VPS. It is invoked by the CI mode below after the
# script has been copied to the host.
if [[ "${1:-}" == "remote" ]]; then
	set -euo pipefail
	PACKAGE_PATH="${2:?Package path is required}"
	APP_DIR="${3:?App directory is required}"
	: "${DEPLOY_ENV:?DEPLOY_ENV is required}"
	deploy_target
	provision_tls_certificate
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
	docker build --tag "$IMAGE_TAG" "$STAGING_DIR"

	# Replace the on-disk deployment only after the new image builds successfully.
	find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf -- {} +
	cp -a "$STAGING_DIR"/. "$APP_DIR"/
	echo "Deploying DEPLOY_ENV=${DEPLOY_ENV} container=${CONTAINER_NAME} port=${HOST_PORT} origin=${APP_ORIGIN} nginx=parascene-${DEPLOY_ENV}"
	# Refuse to touch the other slot's container name.
	if [[ "$DEPLOY_ENV" == "beta" && "$CONTAINER_NAME" != "parascene" ]]; then
		echo "beta deploy must use container parascene (got ${CONTAINER_NAME})" >&2
		exit 1
	fi
	if [[ "$DEPLOY_ENV" == "prod" && "$CONTAINER_NAME" != "parascene-prod" ]]; then
		echo "prod deploy must use container parascene-prod (got ${CONTAINER_NAME})" >&2
		exit 1
	fi
	docker rm --force "$CONTAINER_NAME" 2>/dev/null || true
	docker run --detach \
		--name "$CONTAINER_NAME" \
		--restart unless-stopped \
		--env-file "$APP_DIR/.env" \
		--publish "127.0.0.1:${HOST_PORT}:3000" \
		"$IMAGE_TAG"

	# Nginx is versioned with the app, but installed as a separate privileged
	# host concern. Validation and rollback happen before public health checks.
	rendered_nginx="$(render_nginx_config "$APP_DIR")"
	install_nginx_config "$rendered_nginx"

	# Verify the public nginx-to-Docker path. Keep retrying while the container starts.
	# Prod serves the site, CDN and canonical share host; API remains on Vercel.
	for attempt in {1..30}; do
		if [[ "$DEPLOY_ENV" == "prod" ]]; then
			if https_ok "$SITE_HOST" / && \
				https_ok "$CDN_HOSTNAME" /healthz && \
				https_ok "sh.parascene.com" /; then
				exit 0
			fi
		else
			api_status="$(https_status "$API_TEST_HOSTNAME" /)"
			share_status="$(https_status "$SHARE_TEST_HOSTNAME" /)"
			if https_ok "$SITE_HOST" / && \
				https_ok "$CDN_TEST_HOSTNAME" /healthz && \
				[[ "$api_status" == "302" && "$share_status" == "302" ]]; then
				exit 0
			fi
		fi
		sleep 2
	done
	docker ps -a --filter "name=${CONTAINER_NAME}"
	docker logs --tail=200 "$CONTAINER_NAME"
	exit 1
fi

# CI mode runs on the GitHub Actions runner. It packages the app, transfers
# the package and runtime secrets, then invokes this same script remotely.
: "${DEPLOY_ENV:?DEPLOY_ENV is required}"
: "${VPS_HOST:?VPS_HOST is required}"
: "${VPS_USER:?VPS_USER is required}"
: "${VPS_SSH_KEY:?VPS_SSH_KEY is required}"
: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required for realtime authentication}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${SESSION_SECRET:?SESSION_SECRET is required}"
: "${UPSTASH_QSTASH_TOKEN:?UPSTASH_QSTASH_TOKEN is required for creation jobs}"
: "${UPSTASH_QSTASH_URL:?UPSTASH_QSTASH_URL is required for creation jobs}"
: "${CLOUDFLARE_DNS_API_TOKEN:?CLOUDFLARE_DNS_API_TOKEN is required for TLS certificate automation}"
deploy_target

SSH_DIR="$RUNNER_TEMP/parascene-ssh"
PACKAGE_PATH="$RUNNER_TEMP/parascene.tar.gz"
BUILD_DIR="$RUNNER_TEMP/parascene-deploy-build"
REMOTE="$VPS_USER@$VPS_HOST"
SSH_OPTS=(-i "$SSH_DIR/id_ed25519" -o UserKnownHostsFile="$SSH_DIR/known_hosts" -o StrictHostKeyChecking=yes)
REMOTE_PACKAGE="/tmp/parascene-${DEPLOY_ENV}.tar.gz"
REMOTE_SCRIPT="/tmp/deploy-parascene-${DEPLOY_ENV}.sh"

# Validate and build the exact deployment payload before creating credentials,
# contacting the VPS, or changing anything on the deployment host.
mkdir -p "$BUILD_DIR"
tar --exclude='.env' \
	--exclude='./_legacy' \
	--exclude='./_legacy.beta' \
	--exclude='./.git' \
	--exclude='./node_modules' \
	--exclude='./_docs' \
	--exclude='./.github' \
	--exclude='./.cursor' \
	--exclude='./.output' \
	--exclude='./.vercel' \
	--exclude='./build' \
	-czf "$PACKAGE_PATH" .
tar -xzf "$PACKAGE_PATH" -C "$BUILD_DIR"
docker build --tag parascene:ci "$BUILD_DIR"

# Keep the private key and known-hosts file inside the runner's temporary area.
install -m 700 -d "$SSH_DIR"
printf '%s\n' "$VPS_SSH_KEY" > "$SSH_DIR/id_ed25519"
chmod 600 "$SSH_DIR/id_ed25519"
ssh-keyscan -H "$VPS_HOST" > "$SSH_DIR/known_hosts"

# Transfer the app package and this script separately. The script is needed on
# the host before the package has been extracted.
scp "${SSH_OPTS[@]}" "$PACKAGE_PATH" "$REMOTE:$REMOTE_PACKAGE"
scp "${SSH_OPTS[@]}" scripts/deploy-from-ci.sh "$REMOTE:$REMOTE_SCRIPT"

# Keep the Cloudflare token out of the app's runtime .env; Certbot reads this
# root-only file during certificate issue and renewal. The token travels on
# SSH stdin and is never included in the remote command or printed.
printf 'dns_cloudflare_api_token = %s\n' "$CLOUDFLARE_DNS_API_TOKEN" | \
	ssh "${SSH_OPTS[@]}" "$REMOTE" \
	"set -euo pipefail; sudo -n install -d -o root -g root -m 700 /etc/letsencrypt; sudo -n tee /etc/letsencrypt/cloudflare.ini >/dev/null; sudo -n chmod 600 /etc/letsencrypt/cloudflare.ini"

# Write runtime secrets directly to the VPS with restrictive permissions; they
# are passed to Docker through --env-file and are never put in the archive.
printf '%s\n' \
	"SUPABASE_URL=$SUPABASE_URL" \
	"SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
	"SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" \
	"SESSION_SECRET=$SESSION_SECRET" \
	"REPLICATE_API_TOKEN=${REPLICATE_API_TOKEN:-}" \
	"RESEND_API_KEY=${RESEND_API_KEY:-}" \
	"RESEND_SYSTEM_EMAIL=${RESEND_SYSTEM_EMAIL:-}" \
	"UPSTASH_QSTASH_CURRENT_SIGNING_KEY=${UPSTASH_QSTASH_CURRENT_SIGNING_KEY:-}" \
	"UPSTASH_QSTASH_NEXT_SIGNING_KEY=${UPSTASH_QSTASH_NEXT_SIGNING_KEY:-}" \
	"UPSTASH_QSTASH_TOKEN=${UPSTASH_QSTASH_TOKEN:-}" \
	"UPSTASH_QSTASH_URL=${UPSTASH_QSTASH_URL:-}" \
	"UPSTASH_REDIS_REST_TOKEN=${UPSTASH_REDIS_REST_TOKEN:-}" \
	"UPSTASH_REDIS_REST_URL=${UPSTASH_REDIS_REST_URL:-}" \
	"APP_ORIGIN=$APP_ORIGIN" \
	"API_HOSTNAME=$API_HOSTNAME" \
	"CDN_HOSTNAME=$CDN_HOSTNAME" \
	"CDN_HOST_ALIASES=${CDN_HOST_ALIASES:-}" \
	"CREATION_JOB_MODE=$CREATION_JOB_MODE" \
	"CREATION_WORKER_ORIGIN=$CREATION_WORKER_ORIGIN" \
	"APP_VERSION=$DEPLOY_ENV" \
	"BUILD_COMMIT=$GITHUB_SHA" \
	"BUILD_COMMIT_URL=https://github.com/crosshj/parascene/commit/$GITHUB_SHA" \
	"BUILD_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"ASSET_VERSION=$GITHUB_SHA" | \
ssh "${SSH_OPTS[@]}" "$REMOTE" "set -euo pipefail; install -d -m 755 \"\$HOME/${APP_HOME_NAME}\"; umask 077; cat > \"\$HOME/${APP_HOME_NAME}/.env\"; chmod 600 \"\$HOME/${APP_HOME_NAME}/.env\""

# Start the remote deployment and remove the temporary script afterward.
ssh "${SSH_OPTS[@]}" "$REMOTE" \
	"DEPLOY_ENV=$(printf '%q' "$DEPLOY_ENV") bash ${REMOTE_SCRIPT} remote ${REMOTE_PACKAGE} \"\$HOME/${APP_HOME_NAME}\"; rm -f ${REMOTE_SCRIPT}"
