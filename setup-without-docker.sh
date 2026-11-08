#!/usr/bin/env bash
# MandiBazaar setup WITHOUT Docker (Homebrew Postgres)
set -euo pipefail

cd "$(dirname "$0")"

export HOMEBREW_NO_AUTO_UPDATE=1
export PATH="/usr/local/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"

echo "==> 1) Checking Homebrew Postgres..."
if ! command -v psql >/dev/null 2>&1; then
  echo "Postgres nahi mila. Install ho raha hai (pehli baar thoda time lagega)..."
  brew install postgresql@16
  export PATH="/usr/local/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi

echo "    psql: $(command -v psql)"

echo "==> 2) Starting Postgres service..."
brew services start postgresql@16 >/dev/null 2>&1 || true
sleep 2

# Wait until accepting connections
for i in $(seq 1 30); do
  if pg_isready -q 2>/dev/null; then
    echo "    Postgres ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Postgres start nahi hua."
    echo "Try: brew services restart postgresql@16"
    exit 1
  fi
  sleep 1
done

echo "==> 3) Creating role + database (if missing)..."
# Homebrew Postgres usually uses your macOS username as superuser (no password)
ME="$(whoami)"
createuser -s zulaal 2>/dev/null || true
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL' || true
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zulaal') THEN
    CREATE ROLE zulaal LOGIN PASSWORD 'zulaal' SUPERUSER;
  ELSE
    ALTER ROLE zulaal WITH LOGIN PASSWORD 'zulaal' SUPERUSER;
  END IF;
END
$$;
SQL

createdb -O zulaal zulaal 2>/dev/null || true
# Ensure password auth works for local URL
psql -d postgres -c "ALTER ROLE zulaal WITH PASSWORD 'zulaal';" >/dev/null

# Update .env to use local brew postgres (trust/password on localhost)
if [ ! -f .env ]; then
  cp .env.example .env
fi

# Prefer password URL; if peer auth fails, user can switch
# Homebrew often allows local socket as current user — Prisma needs TCP URL
# Use 127.0.0.1 with password
if grep -q '^DATABASE_URL=' .env; then
  # macOS sed
  sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL="postgresql://zulaal:zulaal@127.0.0.1:5432/zulaal?schema=public"|' .env
else
  echo 'DATABASE_URL="postgresql://zulaal:zulaal@127.0.0.1:5432/zulaal?schema=public"' >> .env
fi

# Ensure pg_hba allows password for local TCP — try connection
echo "==> 4) Testing DB connection..."
if ! PGPASSWORD=zulaal psql -h 127.0.0.1 -U zulaal -d zulaal -c 'SELECT 1' >/dev/null 2>&1; then
  echo "    Password TCP auth fail — trying socket as $ME and granting..."
  psql -d postgres <<SQL
ALTER ROLE zulaal WITH PASSWORD 'zulaal';
GRANT ALL PRIVILEGES ON DATABASE zulaal TO zulaal;
SQL
  # Fallback: use current OS user without password via localhost trust
  # Create ~/.pgpass
  echo "127.0.0.1:5432:zulaal:zulaal:zulaal" > "$HOME/.pgpass"
  chmod 600 "$HOME/.pgpass"
  if ! PGPASSWORD=zulaal psql -h 127.0.0.1 -U zulaal -d zulaal -c 'SELECT 1' >/dev/null 2>&1; then
    echo "WARNING: zulaal user TCP login fail. Switching DATABASE_URL to peer/superuser fallback."
    # Use current mac user (no password) — common on Homebrew
    sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=\"postgresql://${ME}@127.0.0.1:5432/zulaal?schema=public\"|" .env
  fi
fi

echo "==> 5) npm install..."
npm install

echo "==> 6) Prisma migrate..."
npx prisma migrate deploy

echo "==> 7) Seed..."
npm run db:seed

echo ""
echo "============================================"
echo "  MandiBazaar ready (NO Docker)!"
echo "  Run:  npm run dev"
echo "  Open: http://localhost:3000"
echo ""
echo "  Admin:    admin@zulaal.com / Admin@12345"
echo "  Customer: 03009876543 / Customer@123"
echo "============================================"
echo ""
echo "Note: Docker engine aapke Mac pe hang hai (Server section empty)."
echo "Is liye Homebrew Postgres use ho raha hai — theek hai local testing ke liye."
