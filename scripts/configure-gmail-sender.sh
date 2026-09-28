#!/usr/bin/env bash
set -euo pipefail

sender='buva.fragrance@gmail.com'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for command_name in kubectl node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required.\n' "$command_name" >&2
    exit 1
  fi
done

kubectl -n buva get secret buva-gmail >/dev/null

printf 'Enter the Gmail app password for %s (input is hidden): ' "$sender" >/dev/tty
IFS= read -r -s app_password </dev/tty
printf '\n' >/dev/tty
app_password="${app_password// /}"
if [[ ${#app_password} -ne 16 ]]; then
  printf 'Expected a 16-character Gmail app password. The production sender was not changed.\n' >&2
  exit 1
fi

if ! printf '%s' "$app_password" | node "$script_dir/verify-gmail-sender.cjs" "$sender"; then
  printf 'Gmail authentication failed. The production sender was not changed.\n' >&2
  exit 1
fi

printf '%s' "$app_password" | kubectl -n buva create secret generic buva-gmail \
  --from-literal="GMAIL_USER=$sender" \
  --from-file=GMAIL_APP_PASSWORD=/dev/stdin \
  --dry-run=client -o yaml | kubectl -n buva apply -f -
unset app_password

kubectl -n buva rollout restart deployment/buva-backend
kubectl -n buva rollout status deployment/buva-backend --timeout=180s
printf 'BUVA outbound sender is configured as %s.\n' "$sender"
