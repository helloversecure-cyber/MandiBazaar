# MandiBazaar — Local Run + Edge-Case Checklist

Yeh guide Roman Urdu + English mein hai taake aap app chala ke poori tarah test kar sako.

---

## 0) Pehli baar setup (ek dafa)

### Zaroori software
1. **Node.js 18+** (aapke paas already hai)
2. **Docker Desktop** (Postgres ke liye) — Mac pe open karke running rakho
3. Terminal

### Project folder
```bash
cd /Users/apple/StudioProjects/Zulaal
```

### Easy way (recommended)
```bash
chmod +x setup-local.sh
./setup-local.sh
npm run dev
```

Browser: http://localhost:3000

---

## 1) Manual steps (agar script na chale)

```bash
cd /Users/apple/StudioProjects/Zulaal

# 1. Docker Desktop ON hona chahiye
docker compose up -d

# 2. Env
cp .env.example .env   # agar .env nahi hai

# 3. Packages
npm install

# 4. Database tables
npx prisma migrate deploy

# 5. Demo products / admin / customer
npm run db:seed

# 6. App start
npm run dev
```

### Useful URLs
| Kya | URL |
|-----|-----|
| Store | http://localhost:3000 |
| Shop | http://localhost:3000/products |
| Cart | http://localhost:3000/cart |
| Checkout | http://localhost:3000/checkout |
| Admin | http://localhost:3000/admin |
| Admin login | http://localhost:3000/login?portal=admin |
| Prisma DB UI | `npx prisma studio` → http://localhost:5555 |

### Demo accounts
| Role | Login | Password |
|------|--------|----------|
| Admin | `admin@zulaal.com` | `Admin@12345` |
| Customer | `03009876543` | `Customer@123` |

Coupons: `FRESH10`, `WELCOME200`

---

## 2) Rozana kaise chalana hai

```bash
cd /Users/apple/StudioProjects/Zulaal
docker compose up -d      # agar Postgres band ho
npm run dev
```

Stop:
- App: terminal mein `Ctrl + C`
- DB: `docker compose stop`

DB reset (sab data wipe):
```bash
docker compose down -v
docker compose up -d
npx prisma migrate deploy
npm run db:seed
```

---

## 3) JazzCash (local testing)

Abhi `.env` mein JazzCash empty hai → checkout **simulate** mode use karta hai (real JazzCash ke bina order confirm ho jata hai).

Real JazzCash ke liye `.env` mein bharo:
```
JAZZCASH_MERCHANT_ID=...
JAZZCASH_PASSWORD=...
JAZZCASH_INTEGRITY_SALT=...
JAZZCASH_RETURN_URL=http://localhost:3000/api/jazzcash/callback
JAZZCASH_SANDBOX=true
```

**Kabhi bhi** JazzCash secrets frontend mein mat dalna.

---

## 4) Edge-case test checklist (aap khud verify karo)

Har step ke baad expected result likha hai.

### A) Auth
- [ ] Customer register → login → logout
- [ ] Galat password → error
- [ ] 5+ failed logins → temporary lock message
- [ ] Normal customer `/admin` pe na ja sake
- [ ] Admin sirf `?portal=admin` se admin login

### B) Catalog / search
- [ ] Home pe featured / best sellers / seasonal dikhein
- [ ] `/products` filters: category, price, organic, in-stock, sort
- [ ] Search `organic honey` → results + count
- [ ] Wrong search → no-result state
- [ ] Product detail: variants (honey 250g/500g/1kg), gallery, related

### C) Cart / stock
- [ ] Add to cart (login required)
- [ ] Qty +/- / remove
- [ ] Out-of-stock product add na ho
- [ ] Low stock warning
- [ ] Prices cart mein **server** se recalculate hon (frontend price trust nahi)

### D) Coupons
- [ ] `FRESH10` valid order pe discount
- [ ] Minimum amount se kam pe coupon reject
- [ ] Invalid/expired code reject

### E) Delivery fee (sab se important)
- [ ] Lahore order pe delivery fee ~ Rs. 250 (settings se)
- [ ] Free delivery threshold (seed: Rs. 5000+) pe fee = 0
- [ ] Checkout pe clearly: **Delivery fee = JazzCash required**
- [ ] Product payment: ○ JazzCash now  ○ Cash to rider
- [ ] Poora COD (delivery fee skip) option **nahi** hona chahiye

### F) Checkout / payment
- [ ] Empty cart checkout fail
- [ ] Address save (Home/Office) + select
- [ ] Pay pe button disable / “Processing…” (double click duplicate order na bane — idempotency key)
- [ ] Simulate success → confirmation page
  - order number `ORD-YYYYMMDD-xxxxxx`
  - delivery fee paid / product paid / remaining clear
- [ ] Cash-to-rider choose → remaining amount > 0, delivery fee paid
- [ ] JazzCash now choose → remaining 0 after pay
- [ ] Payment fail path: `/checkout/payment?error=...` → retry possible
- [ ] Browser band karke bhi order `/account/orders` se milna chahiye

### G) Orders / inventory
- [ ] Order place → stock **reserved**
- [ ] Admin order cancel → reserved stock release
- [ ] Admin: Confirmed → Processing → Packed → Ready → Assign rider → Out for delivery → Delivered
- [ ] Invalid jump (e.g. Delivered → Processing) fail hona chahiye
- [ ] Delivered pe stock finalize / sold increase
- [ ] Cash order: admin “Mark cash collected” → remaining 0, Payment Collected

### H) Admin
- [ ] Dashboard cards + revenue accounting (gross / discount / delivery / refunds / cash / online)
- [ ] Products create / archive
- [ ] Categories activate/deactivate
- [ ] Inventory adjust (+/-)
- [ ] Riders add + assign to order
- [ ] Coupons create
- [ ] Settings: delivery fee / free threshold change → naya checkout fee update
- [ ] Reports CSV export
- [ ] Audit logs mein actions dikhein
- [ ] Settings mein JazzCash secrets `********` / env-only (frontend pe raw secret nahi)

### I) Reviews / wishlist
- [ ] Wishlist add/remove
- [ ] Review sirf **delivered** purchase pe allow (warna error)

### J) Security / trust boundaries
- [ ] Cart prices change karke API se sasta order na ban sake (server recalculates)
- [ ] Delivery fee frontend se override na ho
- [ ] Payment success frontend claim se order paid na ho — sirf callback/verify

### K) Concurrent / race (advanced)
- [ ] Do browsers se last 1 stock pe order → ek succeed, doosra “insufficient stock”
- [ ] Same idempotency / double Pay → duplicate order na bane

---

## 5) Common problems

| Problem | Fix |
|---------|-----|
| `Can't reach database localhost:5432` | Docker Desktop start → `docker compose up -d` |
| Port 3000 busy | `npm run dev -- -p 3001` |
| Seed fail / roles missing | `npm run db:seed` dobara |
| Prisma client outdated | `npx prisma generate` |
| Images nahi dikhti | Neon Console se Object Storage keys set karo (NEON_STORAGE_*) |

DB dekhne ke liye:
```bash
npx prisma studio
```

Tests:
```bash
npm test
```

---

## 6) Mobile app ke liye baad mein

Wahi APIs use hongi:
`/api/products`, `/api/cart`, `/api/checkout`, `/api/orders`, `/api/jazzcash/...`

Base URL local: `http://localhost:3000`  
(Phone pe test: Mac ka LAN IP + same port, Postgres/Docker host pe hi rahega.)
