#!/bin/sh
# The forced command of the CI deploy key (installed as /usr/local/bin/notaflow-deploy, owned by root).
# The key can only deploy the tip of production, or go back to a version deployed before it: the
# compose file and the image both come from that commit, so a stolen key cannot start a container
# of its own choice.
#   notaflow-deploy up <commit sha> <image digest>   (stdin: a GHCR token that can read the image)
#   notaflow-deploy rollback                         (stdin: the same token)
#   notaflow-deploy health
set -euf

REPO=Vapulab/notaflow
IMAGE_NAME=ghcr.io/vapulab/notaflow
DIR=/opt/notaflow
# One line "<sha> <digest>" per good deploy, newest last; the last line is the running version.
HISTORY=$DIR/deploys.log
KEEP=5

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

# The digest pins the bytes the CI built: a tag pushed again later cannot change what runs.
start() {
  sha=$1
  digest=$2
  compose=$(mktemp "$DIR/compose.yaml.XXXXXX")
  config=$(mktemp -d)
  trap 'rm -rf "$compose" "$config"' EXIT
  fetch "https://raw.githubusercontent.com/$REPO/$sha/deploy/compose.yaml" > "$compose"
  chmod 644 "$compose"

  # The token logs in for this pull only, in a Docker config of its own: the VPS also deploys Vapulab.
  # The tag before the digest is only a label: the app reads it as its Sentry release.
  export IMAGE="$IMAGE_NAME:$sha@$digest"
  DOCKER_CONFIG=$config docker login ghcr.io -u notaflow-deploy --password-stdin >/dev/null
  DOCKER_CONFIG=$config docker compose -f "$compose" pull app
  mv "$compose" compose.yaml
  # IMAGE goes into .env only after a good pull, so a manual compose run uses the running version.
  sed -i '/^IMAGE=/d' .env
  echo "IMAGE=$IMAGE" >> .env
  unset IMAGE
  docker compose up -d --remove-orphans
  docker image prune -f >/dev/null
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
    [ $# -eq 3 ] || fail "usage: up <40-character commit sha> <sha256:image digest>"
    sha=$2
    digest=$3
    printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' || fail "usage: up <40-character commit sha> <sha256:image digest>"
    printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail "usage: up <40-character commit sha> <sha256:image digest>"
    # Only the tip: an older commit would roll back to code with fixed bugs, past what rollback allows.
    tip=$(fetch "https://api.github.com/repos/$REPO/commits/production" |
      grep -o '"sha": *"[0-9a-f]\{40\}"' | head -n 1 | sed 's/.*"\([0-9a-f]*\)"$/\1/')
    [ "$tip" = "$sha" ] || fail "commit $sha is not the tip of production (${tip:-unknown})"
    start "$sha" "$digest"
    echo "$sha $digest" >> "$HISTORY"
    tail -n "$KEEP" "$HISTORY" > "$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY"
    ;;
  rollback)
    [ $# -eq 1 ] || fail "usage: rollback"
    # Each rollback drops the running version and starts the one before it, at most KEEP-1 steps back.
    [ -f "$HISTORY" ] && [ "$(wc -l < "$HISTORY")" -ge 2 ] || fail "no earlier version in $HISTORY"
    previous=$(tail -n 2 "$HISTORY" | head -n 1)
    start "${previous% *}" "${previous#* }"
    sed -i '$d' "$HISTORY"
    echo "rolled back to ${previous% *}"
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
    fail "usage: up <commit sha> <image digest> | rollback | health"
    ;;
esac
