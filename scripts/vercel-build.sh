#!/usr/bin/env bash
# Vercel runs `npm run vercel-build` instead of `npm run build` when this script exists.
# Production deploys (pushes to main) apply pending Prisma migrations with the
# DATABASE_URL set in Vercel, then build. Preview deploys (PR branches) only build,
# so a PR can never change the production database before it is merged.
# If a migration fails the build stops and the live site keeps the previous deploy.
# Set DIRECT_URL in Vercel to the non-pooled Neon URL if DATABASE_URL is the pooler.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "vercel-build: production deploy, applying database migrations"
  DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" npx prisma migrate deploy
else
  echo "vercel-build: ${VERCEL_ENV:-local} build, skipping migrations"
fi

npx next build
