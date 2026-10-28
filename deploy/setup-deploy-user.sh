#!/bin/sh
# Run once as root on the VPS, from a checkout of this repo's deploy/ folder:
#   sh setup-deploy-user.sh "ssh-ed25519 AAAA... notaflow-deploy"
# It makes the user notaflow-deploy, whose key can only run notaflow-deploy (see notaflow-deploy.sh).
# The user is in the docker group, so a shell for it would be root: the forced command is the guard.
set -eu

key=${1:?usage: setup-deploy-user.sh "<ssh public key>"}
case "$key" in
  ssh-ed25519\ *) ;;
  *) echo "the key must be one ssh-ed25519 public key line" >&2; exit 1 ;;
esac

here=$(dirname "$0")
id notaflow-deploy >/dev/null 2>&1 || useradd --system --create-home --shell /bin/sh notaflow-deploy
usermod -aG docker notaflow-deploy

install -m 755 -o root -g root "$here/notaflow-deploy.sh" /usr/local/bin/notaflow-deploy

# The deploy replaces compose.yaml and the IMAGE line of .env; nothing else in /opt/notaflow.
chown notaflow-deploy /opt/notaflow /opt/notaflow/compose.yaml /opt/notaflow/.env
chmod 600 /opt/notaflow/.env

home=$(getent passwd notaflow-deploy | cut -d: -f6)
install -d -m 700 -o notaflow-deploy -g notaflow-deploy "$home/.ssh"
printf 'command="/usr/local/bin/notaflow-deploy",restrict %s\n' "$key" > "$home/.ssh/authorized_keys"
chown notaflow-deploy:notaflow-deploy "$home/.ssh/authorized_keys"
chmod 600 "$home/.ssh/authorized_keys"
echo "notaflow-deploy is ready. Remove the old CI key from /root/.ssh/authorized_keys after the first good deploy."
