#!/usr/bin/env bash
# Local gate for the SAM stacks: typecheck → tests → `sam validate --lint` (stack3-query, the optional
# Athena stack, has no code — lint only). Makes no AWS calls:
# credentials and profile are stripped and SAM telemetry is off, so anything that tried to reach AWS
# would fail here instead of passing silently. Prerequisite: `npm ci` in each stack.
set -euo pipefail
cd "$(dirname "$0")"
STACKS=(stack1-ingest stack2-index)

for s in "${STACKS[@]}"; do
  [ -d "$s/node_modules" ] || { echo "$s: node_modules missing — run 'npm ci' in $s" >&2; exit 1; }
done
for s in "${STACKS[@]}"; do echo "== typecheck $s"; (cd "$s" && npm run --silent typecheck); done
for s in "${STACKS[@]}"; do echo "== test $s"; (cd "$s" && npm test --silent); done
for s in "${STACKS[@]}" stack3-query; do
  echo "== sam validate --lint $s"
  env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true SAM_CLI_TELEMETRY=0 \
    sam validate --lint --region ap-northeast-2 -t "$s/template.yaml"
done
echo "verify-local: PASS"
