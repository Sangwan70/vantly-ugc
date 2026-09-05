#!/usr/bin/env bash
# Deploy all Supabase Edge Functions with correct flags.
#
# All functions use --no-verify-jwt because the CLI authenticates
# with API keys (ma_ prefix), not JWTs. Auth is handled at the
# application layer in _shared/auth.ts.
#
# Usage:
#   ./supabase/deploy.sh              # deploy all functions
#   ./supabase/deploy.sh generate     # deploy a single function
#   ./supabase/deploy.sh --dry-run    # print commands without executing

set -euo pipefail

PROJECT_REF="ppwvarkmpffljlqxkjux"

FUNCTIONS=(
  apikey-manage
  auto-topup
  billing-history
  cancel-subscription
  checkout
  credits-check
  device-token
  feedback
  gallery-delete
  generate
  health-status
  invite-redeem
  job-status
  mailer-automation-runner
  poll-provider
  presigned-url
  pricing
  stripe-portal
  ugc-video
  upload-url
  usage-stats
  webhook-provider
  webhook-razorpay
  webhook-stripe
)
# NOTE (2026-09): billing-history and cancel-subscription were missing from
# this list before the RazorPay work landed -- pre-existing, not introduced
# here. They (and every other function) DO already get deployed via
# .github/workflows/deploy.yml, which globs every supabase/functions/*/
# directory instead of hardcoding names -- this script is the manual/local
# convenience path, kept in sync here for anyone running it directly.

DRY_RUN=false
TARGET=""

for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=true
  else
    TARGET="$arg"
  fi
done

deploy_function() {
  local fn="$1"
  local cmd="supabase functions deploy $fn --no-verify-jwt --project-ref $PROJECT_REF"

  if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] $cmd"
  else
    echo "Deploying $fn..."
    $cmd
    echo "  Done: $fn"
  fi
}

if [ -n "$TARGET" ]; then
  deploy_function "$TARGET"
else
  echo "Deploying ${#FUNCTIONS[@]} edge functions to $PROJECT_REF"
  echo ""
  for fn in "${FUNCTIONS[@]}"; do
    deploy_function "$fn"
  done
  echo ""
  echo "All ${#FUNCTIONS[@]} functions deployed."
fi
