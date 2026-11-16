# MandiBazaar — QA Test Plan (Production)

> **How to use this doc (QA ke liye):** Har test case ke steps follow karein, phir **Result** column mein ✅ Pass / ❌ Fail likhein aur koi bhi masla **Notes** mein likhein (screenshot + jo email/phone use kiya + jo page/URL tha). Jahan "Expected" na mile, usay Fail maarein aur detail likhein. Koi bhi 🔴 **P0/P1** issue mile to foran project owner ko batayein.

- **Site:** https://www.mandibazaar.pk
- **Platform:** Pakistani multi-role grocery marketplace
- **Roles:** Customer · Store Owner · Rider · Super Admin
- **Payments:** Cash on Delivery (COD) + JazzCash QR/Till (manual receipt → admin verify → order confirm). *Card/Stripe disabled hai.*
- **Currency/locale:** PKR, Pakistan
- **Test build date:** _(fill in)_   **Tester:** _(fill in)_   **Device/Browser:** _(fill in)_

---

## 0. Before you start (Setup & test data)

| # | Item | Detail |
|---|---|---|
| 0.1 | Test emails | **Asli Gmail** use karein (ya Outlook). Verification email isi pe aayegi. Disposable (YOPmail) se bachein — kabhi filter karta hai. |
| 0.2 | Test phone numbers | Pakistani format: `03XXXXXXXXX`. Har naye account ke liye alag number. |
| 0.3 | Admin login | Project owner se alag se lein (is doc mein password na likhein). Portal: `/login?portal=admin` |
| 0.4 | JazzCash test | Real paisa na bhejein — testing ke liye owner se poochein ya chhoti raqam. Receipt ke liye koi bhi screenshot chalega (admin verify manually karta hai). |
| 0.5 | Fresh state | Har role ke liye alag account banayein. Ek he email do roles mein use na karein. |
| 0.6 | Bug report format | **Title · Severity (P0/P1/P2/P3) · Steps · Expected · Actual · Screenshot · URL · Email/Phone used · Time** |

**Severity guide:** 🔴 **P0** = paisa/data loss ya core flow block · 🟠 **P1** = major feature toota, kaam nahi · 🟡 **P2** = minor/UX · ⚪ **P3** = cosmetic.

---

## 1. Smoke test (pehle 10 minute — sab theek chal raha hai?)

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| SMK-01 | Homepage load | `/` kholein | Page load ho, koi error nahi, hero + categories + CTAs dikhein | | |
| SMK-02 | Key pages | `/products`, `/stores`, `/login`, `/store`, `/register/rider` kholein | Sab 200 OK, koi crash/blank nahi | | |
| SMK-03 | Search | Header search mein "rice" likh ke search | Search results page khule (products ho ya "no products" empty state) | | |
| SMK-04 | Categories | Homepage/category se "Rice", "Daal" etc. kholein | Category page khule, naam dikhe | | |
| SMK-05 | Payment options | Checkout tak pahunch ke dekhein | Sirf **COD** aur **JazzCash QR** dikhein — **card/Stripe nahi** | | |
| SMK-06 | Mobile view | Phone pe site kholein | Layout sahi, horizontal scroll na ho, buttons tap ho sakein | | |
| SMK-07 | Dark/light | Theme toggle (chand icon) | Theme badle, text readable rahe dono mein | | |

---

## 2. Authentication & Accounts

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| AUTH-01 | Customer signup | `/login` → "Create account" → naya Gmail + phone + password | Account bane, "verify your email" message aaye | | |
| AUTH-02 | Verification email aaye | Gmail inbox (+ Spam) check karein | MandiBazaar branded verification email aaye (1-2 min) | | |
| AUTH-03 | Verify link | Email mein link kholein | Email verify ho jaye, success dikhe | | |
| AUTH-04 | Login after verify | Verified email + password se login | Login ho jaye, home/account khule | | |
| AUTH-05 | Login before verify | Unverified account se login | "Please verify your email first" + **Resend verification** button dikhe | | |
| AUTH-06 | Resend verification | "Resend verification email" dabayein | Nayi email aaye (baar baar na dabayein — rate limit) | | |
| AUTH-07 | Wrong password | Galat password | Saaf error "Wrong email or password" (ya similar), login na ho | | |
| AUTH-08 | Duplicate email | Pehle se bana email se dobara signup | "Email already in use" error | | |
| AUTH-09 | Duplicate phone | Pehle se bana phone se signup | Phone already registered error | | |
| AUTH-10 | Forgot password | `/login` → "Forgot password" → email dalein | Reset email aaye, reset ho jaye, naye password se login ho | | |
| AUTH-11 | Weak password | Signup mein 5-char password | Reject ho, "8–64 chars with a letter and a number" | | |
| AUTH-12 | Logout | Login ke baad logout | Session khatam, protected pages redirect to login | | |
| AUTH-13 | Invalid phone format | `12345` jaisa galat phone | Validation error inline | | |

---

## 3. Customer — Browse, Cart & Checkout

### 3.1 Browse & discovery
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| CUST-01 | Product list | `/products` | Products grid (ya empty state agar 0 products) | | |
| CUST-02 | Category filter | Kisi category pe tap | Us category ke products, sahi heading | | |
| CUST-03 | Search typo | "ric" ya galat spelling | "Did you mean" / relevant results | | |
| CUST-04 | Sort & filter | Sort (price low→high etc.), filters apply | Results theek order/filter hon | | |
| CUST-05 | Deals page | `/products?sort=discount` | Discounted items (ya empty state) | | |
| CUST-06 | Store page | `/stores` → kisi store pe jayein | Store ka profile + uske products | | |
| CUST-07 | Product detail | Kisi product pe tap | Detail page: price, unit, stock, add-to-cart | | |
| CUST-08 | Wishlist | Product ❤️ → `/wishlist` | Wishlist mein add/remove ho | | |

### 3.2 Cart
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| CART-01 | Add to cart | Product add karein | Cart count barhe, item dikhe | | |
| CART-02 | Qty change | Cart mein qty +/- | Total recompute ho, stock se zyada na ho | | |
| CART-03 | Remove item | Item remove | Cart update ho | | |
| CART-04 | Price integrity | Cart total check karein | Total = (unit × qty) − discount + delivery (sahi) | | |
| CART-05 | Empty cart | Sab remove | "Cart empty" state, checkout disabled | | |
| CART-06 | Coupon (agar ho) | Coupon code apply | Valid pe discount, invalid pe error | | |

### 3.3 Checkout — COD
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| COD-01 | Address | Checkout → delivery address dalein | Address save/validate ho | | |
| COD-02 | Delivery fee | Address ke hisab se fee | Rs. 10/km (go+return) ya free on Rs.5,000+ — sahi calculate ho | | |
| COD-03 | Select COD | Payment: Cash on Delivery | COD option clear, instructions dikhein | | |
| COD-04 | Place order | "Confirm order" | Order ban jaye, confirmation page, status CONFIRMED/placed | | |
| COD-05 | Order in history | `/account/orders` | Naya order list mein, sahi amount/status | | |
| COD-06 | Order detail | Order kholein | Items, address, amount, status timeline sahi | | |
| COD-07 | Double submit | "Confirm" jaldi 2 baar | Sirf **1** order bane (duplicate na ho) | | |

### 3.4 Checkout — JazzCash QR (important!)
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| JC-01 | Select JazzCash | Payment: JazzCash QR | QR page khule: QR image + Till ID + USSD hint | | |
| JC-02 | Amount sahi | QR page pe amount | "Pay Rs. X to …" sahi amount (kabhi "Pay 0"/"—" na atke) | | |
| JC-03 | Payee note | QR page padhein | "collected for MandiBazaar by …" clarity note dikhe | | |
| JC-04 | Upload receipt | Koi screenshot upload → submit | "Application/receipt submitted", order **pending** rahe | | |
| JC-05 | Pending state (KEY) | Confirmation/order page dekhein | **"Receipt received — verifying"** dikhe, **"Complete payment / pay again" button na ho** | | |
| JC-06 | No double-pay nudge | Order page `/account/orders/<id>` | "No need to pay again" type note, expire warning na ho | | |
| JC-07 | Admin verify | (Admin se) receipt approve karwayein | Order **CONFIRMED** ho jaye, customer ko update mile | | |
| JC-08 | Admin reject | (Admin se) receipt reject with reason | Customer ko **"declined — upload new receipt"** + reason dikhe, re-upload ho sake | | |
| JC-09 | Duplicate receipt | Pending state mein dobara receipt upload | "A receipt is already waiting for review" block | | |
| JC-10 | Resume payment | Rejected ke baad "Upload a new receipt" | QR page dobara khule, naya receipt upload ho | | |

---

## 4. Customer — Orders, Returns & Profile

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| ORD-01 | Order tracking | Order detail → status timeline | Placed → Confirmed → … → Delivered sahi steps | | |
| ORD-02 | Cancel order | Eligible order cancel karein | Cancel ho, (online paid ho to) refund queue ho | | |
| ORD-03 | Request refund | Delivered/eligible order pe refund request | Refund request ban jaye, amount ≤ paid | | |
| ORD-04 | Invoice | Order ka invoice download | PDF/invoice sahi amounts ke sath | | |
| ORD-05 | Reorder | "Reorder" (agar ho) | Items dobara cart mein | | |
| PROF-01 | Edit profile | `/account` → naam/phone edit | Save ho, email change na ho sake | | |
| PROF-02 | Change password | `/account/security` | Password change ho, dobara login kaam kare | | |
| PROF-03 | Addresses | Address add/edit/delete | Theek save/remove ho | | |
| PROF-04 | Can't edit restricted | Role/balance type field | Aisa koi field editable na ho jo nahi hona chahiye | | |

---

## 5. Store Owner

### 5.1 Signup & approval
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| STR-01 | Open signup | `/store` → "Create store" | Signup form khule | | |
| STR-02 | Owner account | Naam, phone, email, password | Valid ho, duplicate pe error | | |
| STR-03 | Store details | Naam, description, address, city, province | Required fields validate hon | | |
| STR-04 | Location | "Use my current location" ya Maps link | Coordinates capture hon (delivery fee ke liye) | | |
| STR-05 | CNIC | 13-digit CNIC | Format validate ho, duplicate CNIC block ho | | |
| STR-06 | **Categories (predefined)** | Categories section | 12 predefined chips dikhein (Rice, Daal, Atta …) | | |
| STR-07 | **Custom category tag** | "Add your own category" → naam + Enter | Removable **chip** bane; multiple add ho sakein | | |
| STR-08 | Duplicate tag | Wahi category dobara add | "already added" hint dikhe, silently swallow na ho | | |
| STR-09 | Empty categories | Koi category select na karein | Submit block ho: "Select at least one category…" | | |
| STR-10 | Documents | CNIC front/back, shop photo, address proof upload | Uploads ho, required docs enforce hon | | |
| STR-11 | Payout details | Bank/IBAN/JazzCash (kam az kam 1) | Validate ho, kuch na dein to error | | |
| STR-12 | Submit | "Submit for approval" | **"Application submitted"** (generic error na aaye!) | | |
| STR-13 | Pending screen | Login after submit | "Pending approval" + review window + support email dikhe | | |
| STR-14 | Can't access portal | Pending state mein `/store-portal` | Portal block, pending screen pe redirect | | |

### 5.2 After approval
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| STR-15 | Login approved | Admin approve ke baad login | Store portal khule | | |
| STR-16 | Add product | Product add: naam, price, stock, category, image | Product DRAFT bane, submit for review | | |
| STR-17 | Category dropdown | Product form category | Active platform categories dikhein (khaali na ho) | | |
| STR-18 | Product review | Admin approve ke baad | Product ACTIVE, store page pe dikhe | | |
| STR-19 | Can't self-publish | DRAFT ko seedha ACTIVE karne ki koshish | Block ho (admin review zaroori) | | |
| STR-20 | Price change review | ACTIVE product ki price badlein | ±20% se zyada pe admin review mein jaye | | |
| STR-21 | Orders | Store ko order aaye | Store portal mein order dikhe (sirf apne) | | |
| STR-22 | Fulfillment | Order ko pack/ready mark karein | Status update ho | | |
| STR-23 | Earnings | `/store-portal/finance` | Sales − commission sahi dikhe | | |
| STR-24 | Payouts | `/store-portal/payouts` | Weekly payout info sahi | | |
| STR-25 | Tenant isolation | URL se doosre store ka order/data | Access na mile (sirf apna data) | | |

---

## 6. Rider

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| RID-01 | Rider signup | `/register/rider` | Form: docs, vehicle, payout | | |
| RID-02 | Duplicate CNIC | Pehle se used CNIC | Block ho | | |
| RID-03 | Pending state | Signup ke baad | "Waiting for approval" dikhe, login limited | | |
| RID-04 | Approved login | Admin approve ke baad | Rider portal khule | | |
| RID-05 | Available bids | Bids page | Open delivery requests dikhein (ya "no open requests") | | |
| RID-06 | Place bid | Kisi request pe bid | Bid lage, amount bounds ke andar | | |
| RID-07 | Win/assign | Bid accept hone pe | Delivery assign ho | | |
| RID-08 | Mark delivered | Delivery complete mark | Status DELIVERED, double-tap pe double na ho | | |
| RID-09 | COD collection | COD order deliver | Cash collection record ho | | |
| RID-10 | Remittance | COD cash jama karna | Remittance due dikhe, overdue pe COD-restrict warning | | |
| RID-11 | Offline/busy | Status OFFLINE/BUSY set | Naye bids na milein jab OFFLINE | | |
| RID-12 | Isolation | Doosre rider ka order URL | Access na mile | | |

---

## 7. Super Admin

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| ADM-01 | Admin login | `/login?portal=admin` | Admin dashboard khule | | |
| ADM-02 | Store approvals | Pending stores list | Approve/Reject (reason ke sath) kaam kare | | |
| ADM-03 | Approve store | Store approve + location/payout | Store APPROVED, requested categories handle hon | | |
| ADM-04 | Product moderation | Pending products review | Approve/Decline (reason) kaam kare | | |
| ADM-05 | Categories CRUD | Category add/edit/activate/deactivate | Image required to activate; delete block agar products linked | | |
| ADM-06 | Deactivate category | Category inactive karein | Nav + direct link dono se hat jaye | | |
| ADM-07 | **Payment proofs** | Payments page → pending receipt | Receipt image dikhe, Approve/Reject/Refund options | | |
| ADM-08 | Approve receipt | Receipt approve | Order CONFIRMED, double-confirm na ho | | |
| ADM-09 | **Amount check** | Approve mein "amount on receipt" dalein jo due se kam ho | Approval **block** ho ("receipt shows less than due") | | |
| ADM-10 | Reject receipt | Reason ke sath reject | Customer ko reason + re-upload mile | | |
| ADM-11 | Remittance/COD | COD reconciliation page | Rider remittances, confirm/verify kaam kare | | |
| ADM-12 | Payouts | Store payouts | "Settle" kaam kare, double-pay na ho | | |
| ADM-13 | Staff mgmt | Staff create (agar ho) | Role-limited, SUPER_ADMIN create na ho | | |
| ADM-14 | Returned order | COD order RETURNED mark karein | Stock restock ho, rider ki cash-remittance cancel ho (rider ko unfair charge na ho) | | |

---

## 8. Payments — focused scenarios

| ID | Scenario | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| PAY-01 | COD happy path | Order → COD → deliver → cash | Pura flow sahi, amounts match | | |
| PAY-02 | JazzCash full | Full amount QR se → receipt → admin verify | Order confirm, remaining = 0 | | |
| PAY-03 | JazzCash delivery-fee only | Sirf delivery fee online | Sahi amount, product COD rahe | | |
| PAY-04 | Underpaid receipt | Receipt amount < due, admin amount-check use kare | Approval block | | |
| PAY-05 | No double-charge | Receipt pending mein pay-again ka rasta | Na ho (button chhupa ho) | | |
| PAY-06 | Pending expiry | Receipt pending order kuch der chhorein | **Expire na ho** jab tak receipt review mein hai | | |
| PAY-07 | Refund on return | Paid order return | Refund queue ho (online) / remittance cancel (COD) | | |

---

## 9. Negative / security sanity (non-technical QA bhi kar sakta)

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| SEC-01 | Role boundary | Customer account se admin URL (`/admin…`) | Access denied / redirect | | |
| SEC-02 | Other's order | URL mein doosre ka order number | "Not found" / access denied | | |
| SEC-03 | Logged-out protected | Logout → `/account/orders`, `/store-portal`, `/rider-portal` | Login pe redirect | | |
| SEC-04 | Store sees only own | Store A login → B ke orders/products | Na dikhein | | |
| SEC-05 | Forced password | (Agar forced-change account ho) | Change tak doosre pages block | | |
| SEC-06 | XSS-ish input | Naam/category mein `<b>test</b>` type | Plain text raho, HTML execute na ho | | |

---

## 10. Cross-cutting / UX

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| UX-01 | Mobile end-to-end | Phone pe pura customer flow | Sab usable, koi toota layout nahi | | |
| UX-02 | Back/refresh | Form bhar ke back/refresh | Data loss ya crash na ho (ya clear message) | | |
| UX-03 | Slow network | Throttle karke | Loading states dikhein, double-submit na ho | | |
| UX-04 | Empty states | 0 products/stores/orders | Sensible empty message (blank na ho) | | |
| UX-05 | Error messages | Galat input har form mein | Saaf, field-level errors (generic "try again" nahi) | | |
| UX-06 | Links/footer | About, FAQ, Return policy, Terms, Privacy, Contact | Sab khulein, 404 na ho | | |
| UX-07 | Urdu/English text | Mixed content | Readable, overlap na ho | | |

---

## 11. Known limitations (yeh bugs nahi hain — expected)

- **Card/Stripe nahi hai** — sirf COD + JazzCash QR. Card na dikhna **sahi** hai.
- **JazzCash QR manual hai** — customer pay karke receipt upload karta hai; admin verify karta hai tab confirm. Auto-confirm na hona **sahi** hai.
- **Verification link Firebase/branded page pe** khul sakta hai — email verify hona chahiye, bas.
- Production catalog shuru mein khaali ho sakta hai (0 products) jab tak stores list na karein — empty states expected hain.

---

## 12. Sign-off

| Area | Total cases | Pass | Fail | Blocker (P0/P1) |
|---|---|---|---|---|
| Auth | | | | |
| Customer | | | | |
| Store Owner | | | | |
| Rider | | | | |
| Admin | | | | |
| Payments | | | | |
| **Total** | | | | |

**QA verdict:** ⬜ Pass  ⬜ Pass with issues  ⬜ Fail
**Tester:** _______________  **Date:** _______________  **Signature:** _______________

---

### Bug report template (har bug ke liye copy karein)

```
Bug ID:
Title:
Severity: P0 / P1 / P2 / P3
Role: Customer / Store / Rider / Admin
Page / URL:
Account used (email/phone):
Steps to reproduce:
  1.
  2.
  3.
Expected result:
Actual result:
Screenshot/video:
Device / Browser:
Time:
```
