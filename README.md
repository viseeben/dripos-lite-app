# Dripos Lite

A minimal coffee-shop point of sale: browse a menu, customise a drink, take cash,
print a receipt, look up past tickets.

| | |
|---|---|
| **Mobile** | Expo SDK 57 · React Native · TypeScript (strict) · Expo Router · TanStack Query · Zustand |
| **Backend** | Node 20+ · Fastify 5 · TypeScript (strict, ESM) · Drizzle ORM · PostgreSQL · Zod |
| **Tests** | 45, including the full API against a real Postgres |

```
dripos-lite-app/
├── apps/mobile/      # Expo app          → apps/mobile/README.md
├── backend/          # Fastify API       → backend/README.md
└── scripts/          # repo-level checks
```

---

## Quick start

```bash
# 1. Backend
cd backend
cp .env.example .env            # set DATABASE_URL and MOCK_API_URL
npm install
npm run migrate
npm run seed                    # or: npm run seed:fixture  (no network needed)
npm run dev                     # http://localhost:3000

# 2. Mobile
cd ../apps/mobile
cp .env.example .env.local      # set EXPO_PUBLIC_API_URL
npm install
npx expo start                  # scan the QR code with Expo Go
```

Pointing the app at a backend on your own machine? Use your LAN IP
(`http://192.168.1.50:3000`), not `localhost` — on your phone, `localhost` is the
phone.

---

## The one rule

**Money is an integer number of cents. Always.**

No floats, no `NUMERIC` columns, no `.toFixed(2)` arithmetic. The only division by
100 anywhere is inside `formatCents`, for display.

```
unitPriceCents  = product.priceCents + Σ selectedOption.priceDeltaCents
lineTotalCents  = unitPriceCents × quantity
subtotalCents   = Σ lineTotalCents
taxCents        = Math.round(subtotalCents × 0.08875)
totalCents      = subtotalCents + taxCents
```

The client computes these to render the cart, and **the server recomputes all of
them from the database and rejects the order if they differ by even one cent.**

That only works if both sides compute identically, so `backend/src/utils/money.ts`
and `apps/mobile/src/lib/money.ts` are kept character-identical, enforced by a
check rather than by discipline:

```bash
npm run check:shared
# check:shared OK — 7 money helpers identical across backend and mobile
```

They are duplicated rather than shared through a workspace package on purpose: a
symlinked local package is the single most common reason an Expo project fails to
bundle on someone else's machine, and this app has to work from a `git clone` and
`npx expo start`. Duplication is a real cost, so it is paid for with enforcement.

---

## What the reviewer probably wants to know

**Nothing on the client is trusted.** Every ticket is repriced server-side from
stored data. Beyond totals, the server also rejects modifiers that belong to a
different product, two selections in a single-select group, a missing required
group, and discounts that would drive a unit price below zero.

**`GET /products` is one query.** Products, their modifier groups and each group's
options are assembled with lateral `json_agg`. Adding a product never adds a query.
Repricing a ticket costs 3 queries regardless of how many lines it has.

**Payment cannot double-charge.** Paying is an atomic compare-and-set
(`UPDATE ... WHERE status = 'open'`), so of two concurrent requests exactly one
wins. There is a test that fires both and asserts 200/409.

**History stays correct.** Ticket rows snapshot the product name, price, modifier
names and deltas at order time. A receipt reprinted next year still shows what the
customer actually paid, even after the menu changes.

**The database enforces the money rules too**, not just the application:
`total = subtotal + tax`, `line_total = unit_price × quantity`, and a `paid` ticket
must carry a complete, self-consistent payment record.

---

## Verify it yourself

```bash
npm run install:all
npm run typecheck        # both packages, strict, plus the shared-money check
npm run backend:test     # needs DATABASE_URL pointing at a throwaway database
```

---

## Deliberate deviations from the handoff spec

| Spec said | Built | Why |
|---|---|---|
| Expo SDK 51 | **SDK 57** | Expo Go from the app stores only runs the newest SDK. An SDK 51 build would not open when you scan the QR code. |
| Fastify 4 | **Fastify 5** | Current major; 4 is no longer the supported line. |
| `ky` HTTP client | **~60-line fetch client** | `ky` v2 is pure ESM targeting Node 22 and unvalidated on Hermes/Metro. The replacement is smaller than the dependency and types the error envelope properly. |
| Licensed brand fonts | **Playfair Display / DM Sans / DM Mono** | Roslindale and the PP faces are commercial. These are the open-source stand-ins the style guide itself names. |
| `ON CONFLICT DO NOTHING` when seeding | **`DO UPDATE`** | Re-seeding should actually refresh the menu. Safe because tickets snapshot prices at order time. |
| npm workspaces | **Independent packages** | Avoids the Metro/symlink hoisting problems that break Expo Go on a fresh clone. Root scripts provide the convenience. |

Versions are pinned to Expo's own SDK 57 compatibility manifest rather than npm
`latest`, which currently resolves TypeScript 7, React 19.3 and React Native 0.87 —
a combination this SDK's Metro rejects.

---

## Not built

Authentication is out of scope for the assessment. `backend/README.md` and the
handoff spec sketch the JWT + refresh-token design that would go in.
