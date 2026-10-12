#!/bin/sh
# Daily, on the VPS: the newest NotaFlow database backup, compressed, encrypted with age, sent to Cloudflare R2.
# Installed as /opt/notaflow/offsite-backup.sh; see docs/TUTORIALS/DEPLOY_ON_VM.md, "Off-site backups".
set -eu

# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, AGE_RECIPIENT (the public key only).
. /opt/notaflow/offsite.env

latest=$(docker exec notaflow-app-1 sh -c 'ls -t /data/backups/notaflow-*.db | head -1')
name=$(basename "$latest")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

docker cp "notaflow-app-1:$latest" "$work/$name"
gzip -9 "$work/$name"
age -r "$AGE_RECIPIENT" -o "$work/$name.gz.age" "$work/$name.gz"

# The credentials go through stdin, so they never show in the process list. IPv4 only: the R2 token
# allows only the VPS IPv4 address, and the VPS also goes out over IPv6.
printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" |
  curl -4 --config - --fail --silent --show-error --aws-sigv4 'aws:amz:auto:s3' \
    --upload-file "$work/$name.gz.age" "$R2_ENDPOINT/$R2_BUCKET/$name.gz.age"

echo "Sent $name.gz.age to $R2_BUCKET"

# node-exporter reads this file (deploy/monitoring); written then renamed, so a scrape never sees half of it.
textfile=/var/lib/node_exporter/textfile
mkdir -p "$textfile"
printf 'backup_last_timestamp_seconds{kind="offsite"} %s\n' "$(date +%s)" > "$textfile/notaflow_backup.prom.tmp"
mv "$textfile/notaflow_backup.prom.tmp" "$textfile/notaflow_backup.prom"
