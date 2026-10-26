#!/usr/bin/env bash
set -euo pipefail

certificate_dir=/var/lib/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/srv2.amneziya.mozhno.org
certificate="$certificate_dir/srv2.amneziya.mozhno.org.crt"
private_key="$certificate_dir/srv2.amneziya.mozhno.org.key"
state=/var/lib/xray-nl2/certificate.sha256

exec 9>/var/lib/xray-nl2/certificate-reload.lock
flock -n 9 || exit 0
openssl x509 -checkend 0 -noout -in "$certificate" >/dev/null
cmp -s \
  <(openssl x509 -in "$certificate" -pubkey -noout | openssl pkey -pubin -outform DER) \
  <(openssl pkey -in "$private_key" -pubout -outform DER)

current=$(sha256sum "$certificate" | cut -d ' ' -f1)
if [[ ! -f "$state" ]]; then
  printf '%s\n' "$current" > "$state"
  exit 0
fi
[[ "$current" != "$(cat "$state")" ]] || exit 0
[[ "$(docker inspect xray-nl2 --format '{{.State.Running}}')" == true ]] || exit 0

# The panel loads its HTTPS certificate only at startup. Restart this container
# after Caddy renews the certificate; never restart Caddy, Amnezia or Medcluben.
docker restart --time 10 xray-nl2 >/dev/null
printf '%s\n' "$current" > "$state"
