#!/bin/sh
# The forced command of the CI deploy key (installed as /usr/local/bin/notaflow-deploy, owned by root).
# The key can only deploy a commit that is on production: the compose file and the image both come from
# that commit, so a stolen key cannot start a container of its own choice.
#   notaflow-deploy up <commit sha>   (stdin: a GHCR token that can read the image)
#   notaflow-deploy health
set -euf

REPO=Vapulab/notaflow
IMAGE_NAME=ghcr.io/vapulab/notaflow
DIR=/opt/notaflow

fail() {
  echo "notaflow-deploy: $*" >&2
  exit 1
}

# curl when the host has it, else the same pinned image the health check uses.
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$1"
  else
    docker run --rm curlimages/curl:8.10.1 -fsS "$1"
  fi
}

# With a forced command the request is in SSH_ORIGINAL_COMMAND; it is split on spaces and never run.
if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  # shellcheck disable=SC2086
  set -- $SSH_ORIGINAL_COMMAND
fi
if [ "${1:-}" = notaflow-deploy ]; then shift; fi

cd "$DIR"
case "${1:-}" in
  up)
    sha=${2:-}
    printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' || fail "usage: up <40-character commit sha>"
    [ $# -eq 2 ] || fail "usage: up <40-character commit sha>"
    # "ahead" or "identical": production contains the commit. A fork's commit is "diverged" or not found.
    status=$(fetch "https://api.github.com/repos/$REPO/compare/$sha...production" |
      grep -o '"status": *"[a-z]*"' | head -n 1 | sed 's/.*"\([a-z]*\)"$/\1/')
    case "$status" in
      ahead | identical) ;;
      *) fail "commit $sha is not on production (status: ${status:-unknown})" ;;
    esac

    compose=$(mktemp "$DIR/compose.yaml.XXXXXX")
    config=$(mktemp -d)
    trap 'rm -rf "$compose" "$config"' EXIT
    fetch "https://raw.githubusercontent.com/$REPO/$sha/deploy/compose.yaml" > "$compose"
    chmod 644 "$compose"

    # The token logs in for this pull only, in a Docker config of its own: the VPS also deploys Vapulab.
    export IMAGE="$IMAGE_NAME:$sha"
    DOCKER_CONFIG=$config docker login ghcr.io -u notaflow-deploy --password-stdin >/dev/null
    DOCKER_CONFIG=$config docker compose -f "$compose" pull app
    mv "$compose" compose.yaml
    # IMAGE goes into .env only after a good pull, so a manual compose run uses the running version.
    sed -i '/^IMAGE=/d' .env
    echo "IMAGE=$IMAGE" >> .env
    unset IMAGE
    docker compose up -d --remove-orphans
    docker image prune -f >/dev/null
    ;;
  health)
    [ $# -eq 1 ] || fail "usage: health"
    i=0
    while [ $i -lt 45 ]; do
      if docker run --rm --network northub_default curlimages/curl:8.10.1 -fsS http://notaflow:3000/api/health; then
        exit 0
      fi
      i=$((i + 1))
      sleep 2
    done
    docker compose logs --tail 80 app
    exit 1
    ;;
  *)
    fail "usage: up <commit sha> | health"
    ;;
esac
