#!/usr/bin/env bash
# Verify canonical host setup: only https://www.parascene.com returns 200;
# apex and http variants must redirect (301/307/308) to https://www in one hop.
# Prefer 301/308 (permanent); 307 (temporary) is accepted.
#
# Usage: ./scripts/verify-canonical-host.sh [CANONICAL_BASE_URL]
# Example: ./scripts/verify-canonical-host.sh
#          ./scripts/verify-canonical-host.sh https://www.parascene.com

set -e

CANONICAL="${1:-https://www.parascene.com}"
CANONICAL="${CANONICAL%/}"
HOST="${CANONICAL#https://}"
HOST="${HOST#http://}"
APEX="${HOST#www.}"

REDIRECT_URLS=(
	"http://${APEX}"
	"https://${APEX}"
	"http://www.${APEX}"
)
OK_URL="${CANONICAL}/"

FAILED=0

check_redirect() {
	local url="$1"
	local out
	out="$(curl -sI -w '%{http_code}\n%{redirect_url}' -o /dev/null "$url" 2>/dev/null)" || true
	local status
	status="$(echo "$out" | head -1)"
	local location
	location="$(echo "$out" | tail -1)"
	if [[ "$status" != "301" && "$status" != "307" && "$status" != "308" ]]; then
		echo "FAIL: $url → expected 301, 307, or 308, got ${status:-empty}"
		FAILED=1
		return
	fi
	if [[ -z "$location" ]]; then
		# Some curl versions don't set redirect_url; then we can't assert target
		echo "OK:   $url → $status (redirect; target not verified)"
		return
	fi
	if [[ "$location" != "${OK_URL}"* ]]; then
		echo "FAIL: $url → redirect should go to ${OK_URL}..., got $location"
		FAILED=1
	else
		echo "OK:   $url → $status → $location"
	fi
}

check_200() {
	local url="$1"
	local status
	status="$(curl -sI -o /dev/null -w '%{http_code}' "$url" 2>/dev/null)" || echo "000"
	if [[ "$status" != "200" ]]; then
		echo "FAIL: $url → expected 200, got ${status}"
		FAILED=1
	else
		echo "OK:   $url → 200"
	fi
}

echo "Canonical base: $CANONICAL"
echo "---"
echo "Non-canonical hosts must redirect (301/307/308) to $OK_URL:"
for u in "${REDIRECT_URLS[@]}"; do
	check_redirect "$u"
done
echo "---"
echo "Canonical host must return 200:"
check_200 "$OK_URL"
echo "---"

if [[ $FAILED -eq 1 ]]; then
	echo "One or more checks failed."
	exit 1
fi
echo "All checks passed."
exit 0
