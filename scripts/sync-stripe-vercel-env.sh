#!/usr/bin/env bash
# Push Stripe vars from local .env to Vercel (Production + Preview).
# Prereq: `vercel link` in repo root on the MandiBazaar Vercel project.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No env file: $ENV_FILE"
  exit 1
fi

read_env() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | head -1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  local val="${line#*=}"
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  printf '%s' "$val"
}

push_one() {
  local key="$1"
  local target="$2"
  local val
  val="$(read_env "$key")"
  if [[ -z "$val" || "$val" == *"xxxxxxxx"* ]]; then
    echo "Skip (empty/placeholder): $key"
    return 1
  fi
  printf '%s' "$val" | vercel env add "$key" "$target" --force
  echo "Set $key → $target"
}

KEYS=(
  STRIPE_MODE
  STRIPE_SECRET_KEY_TEST
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST
  STRIPE_WEBHOOK_SECRET_TEST
  STRIPE_SECRET_KEY_LIVE
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE
  STRIPE_WEBHOOK_SECRET_LIVE
)

cd "$ROOT"
if [[ ! -d .vercel ]]; then
  echo "Run: vercel link   (select the mandibazaar.pk project), then re-run this script."
  exit 1
fi

failed=0
for key in "${KEYS[@]}"; do
  for target in production preview; do
    push_one "$key" "$target" || failed=1
  done
done

if [[ "$failed" -ne 0 ]]; then
  echo ""
  echo "Some keys were skipped. Minimum for test checkout on production:"
  echo "  STRIPE_MODE=test"
  echo "  STRIPE_SECRET_KEY_TEST, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST"
  echo "  STRIPE_WEBHOOK_SECRET_TEST (from Stripe Dashboard → Webhooks → mandibazaar.pk/api/stripe/webhook)"
  exit 1
fi

echo ""
echo "Redeploy production: vercel --prod"
echo "Verify: curl https://www.mandibazaar.pk/api/payments/config"
