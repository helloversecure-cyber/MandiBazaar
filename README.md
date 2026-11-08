# MandiBazaar — Multi-store mandi marketplace

Full-stack marketplace: customers shop from multiple stores in one cart; **Super Admin** approves stores and settles weekly payouts; **store owners** manage their catalog; **platform riders** do pickup + delivery and remit COD.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma ORM
- NextAuth (credentials) + role-based access
- JazzCash for delivery fees (Rs. 10/km → platform)
- SMS / WhatsApp rider notify (Twilio optional)

## Quick start

```bash
docker compose up -d
cp .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Demo accounts

| Role | Login | Password | Portal |
|------|-------|----------|--------|
| Super Admin | `admin@mandibazaar.com` | `Admin@12345` | [/admin](http://localhost:3000/admin) |
| Store Owner (Fresh Mart) | `03005556677` | `Store@12345` | [/store-portal](http://localhost:3000/store-portal) |
| Store Owner (Desi Kitchen) | `03004445566` | `Store@12345` | [/store-portal](http://localhost:3000/store-portal) |
| Customer | `03009876543` | `Customer@123` | Shop |
| Rider | `03001112233` | `Rider@12345` | (assigned by admin) |

### What seed gives you (all 3 roles)

**Customer** — 35 products, wishlist, coupons `FRESH10` / `WELCOME200`, demo orders in Account → Orders (`DEMO-PACK-001` … `DEMO-DONE-004`).

**Store owner** — products to manage, fulfillments to mark ready, pending weekly payouts.

**Super Admin** — PENDING stores to approve, order ready for rider assign (`DEMO-RIDER-002`), COD remittance pending (`DEMO-COD-003`), store payouts to mark paid.

Store apply: [/sell](http://localhost:3000/sell)

### Money flow

1. **Delivery fee** → JazzCash online → **platform** (Rs. 10/km when map pins exist)
2. **Product amount** → JazzCash now **or** cash to rider (COD)
3. Rider remits COD → Super Admin ledger
4. Weekly: Super Admin pays stores **sales − commission** (bank / JazzCash)

### Coupons

- `FRESH10` — 10% off (min Rs. 1000)
- `WELCOME200` — Rs. 200 off (min Rs. 1500)
