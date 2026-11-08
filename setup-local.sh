#!/usr/bin/env bash
# MandiBazaar — one-command local setup
set -euo pipefail

cd "$(dirname "$0")"

# docker commands kabhi hang ho jate hain — 8s timeout
docker_ok() {
  perl -e 'alarm shift; exec @ARGV' 8 docker info >/dev/null 2>&1
}

echo "==> 1) Checking Docker..."
if ! docker_ok; then
  echo ""
  echo "ERROR: Docker Desktop respond nahi kar raha (hang / starting)."
  echo ""
  echo "Fix (Mac):"
  echo "  1) Menu bar pe Docker whale icon dekho"
  echo "  2) Docker Desktop QUIT karo (right-click whale → Quit)"
  echo "  3) Applications se Docker dobara kholo"
  echo "  4) Wait karo jab tak status 'Docker Desktop is running' ho"
  echo "  5) Phir test karo:"
  echo "       docker info"
  echo "     (2-3 second mein output aani chahiye, hang nahi)"
  echo "  6) Phir:"
  echo "       ./setup-local.sh"
  echo ""
  echo "Agar Docker install nahi / nahi chalana chahte, batao — Postgres ka alternate setup bata denge."
  exit 1
fi

echo "    Docker OK."

echo "==> 2) Starting Postgres..."
perl -e 'alarm shift; exec @ARGV' 120 docker compose up -d

echo "==> 3) Waiting for Postgres to accept connections..."
for i in $(seq 1 40); do
  if perl -e 'alarm shift; exec @ARGV' 5 docker compose exec -T postgres pg_isready -U zulaal -d zulaal >/dev/null 2>&1; then
    echo "    Postgres ready."
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "ERROR: Postgres start nahi hua."
    echo "Check: docker compose logs postgres"
    exit 1
  fi
  printf "    waiting... (%s)\n" "$i"
  sleep 2
done

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env
fi

echo "==> 4) Installing deps (if needed)..."
npm install

echo "==> 5) Prisma migrate..."
npx prisma migrate deploy

echo "==> 6) Seed demo data..."
npm run db:seed

echo ""
echo "============================================"
echo "  MandiBazaar ready!"
echo "  Run:  npm run dev"
echo "  Open: http://localhost:3000"
echo ""
echo "  Admin:    admin@zulaal.com / Admin@12345"
echo "  Customer: 03009876543 / Customer@123"
echo "  Admin UI: http://localhost:3000/login?portal=admin"
echo "============================================"
