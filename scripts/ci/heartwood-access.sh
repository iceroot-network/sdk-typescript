#!/usr/bin/env bash
# heartwood-access.sh: gives git and cargo read access to heartwood-core on a CI machine.
#
#   HEARTWOOD_TOKEN=<token> scripts/ci/heartwood-access.sh
#
# heartwood-core is not public yet, and sdk-rust's Cargo.toml, which the bindings build on, fetches
# heartwood-crypto from it over SSH, at ssh://git@github.com/iceroot-network/heartwood-core.git.
# This script reads it over HTTPS instead, with a read-only token for that repository:
#
# - it masks the token, and the header made from it, in the job's logs;
# - it rewrites heartwood-core's SSH addresses (both spellings) to HTTPS, and sends the token in an
#   HTTP header with requests to that repository only;
# - it sets this up as git configuration in the environment (GIT_CONFIG_COUNT and the rest), not
#   in a file, and makes Cargo fetch through the git command line, which reads that environment
#   even in the repositories Cargo fetches into. The token is never written into a git
#   configuration file, a remote address, a credential store or Cargo's git database;
# - on GitHub Actions it passes the same environment to the job's later steps through GITHUB_ENV.
#   No step may cache or upload that file.
#
# Then it checks the access through the address Cargo uses.
set +x
set -euo pipefail

# A token never contains white space; a pasted secret may end with a line break.
token=$(printf '%s' "${HEARTWOOD_TOKEN:-}" | tr -d '[:space:]')
if [ -z "$token" ]; then
    echo "::error::HEARTWOOD_TOKEN is empty. The repository secret with a read-only token for heartwood-core is missing, or this run gets no secrets (a pull request from a fork)."
    exit 1
fi
printf '::add-mask::%s\n' "$token"
auth=$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\r\n')
printf '::add-mask::%s\n' "$auth"

export CARGO_NET_GIT_FETCH_WITH_CLI=true
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_COUNT="${GIT_CONFIG_COUNT:-0}"
# Adds one git setting after any the environment already holds.
config_env() {
    local key="GIT_CONFIG_KEY_$GIT_CONFIG_COUNT" value="GIT_CONFIG_VALUE_$GIT_CONFIG_COUNT"
    export "$key=$1" "$value=$2"
    if [ -n "${GITHUB_ENV:-}" ]; then
        printf '%s=%s\n' "$key" "$1" "$value" "$2" >>"$GITHUB_ENV"
    fi
    GIT_CONFIG_COUNT=$((GIT_CONFIG_COUNT + 1))
}

https_url="https://github.com/iceroot-network/heartwood-core"
config_env "url.$https_url.insteadOf" "ssh://git@github.com/iceroot-network/heartwood-core"
config_env "url.$https_url.insteadOf" "git@github.com:iceroot-network/heartwood-core"
# Git sends this header only to addresses under https://github.com/iceroot-network/heartwood-core.git/.
config_env "http.$https_url.git.extraheader" "AUTHORIZATION: basic $auth"
if [ -n "${GITHUB_ENV:-}" ]; then
    printf '%s\n' "GIT_CONFIG_COUNT=$GIT_CONFIG_COUNT" \
        'CARGO_NET_GIT_FETCH_WITH_CLI=true' 'GIT_TERMINAL_PROMPT=0' >>"$GITHUB_ENV"
fi

git ls-remote --exit-code "ssh://git@github.com/iceroot-network/heartwood-core.git" HEAD >/dev/null
echo "heartwood-access: heartwood-core is readable"
