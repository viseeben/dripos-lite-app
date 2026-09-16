# Dripos Lite — Backend

Point-of-sale API: menu, tickets, cash payment.

**Stack:** Node 20+, Fastify 5, TypeScript (strict, ESM), Drizzle ORM, PostgreSQL, Zod.

---

## The one rule

**Money is always an integer number of cents.** No floats, no `NUMERIC` columns, no
`.toFixed(2)` arithmetic. The only division by 100 in the codebase is inside
`formatCents`, for display.

Tax is `Math.round(subtotalCents * 0.08875)`, defined once in
[`src/utils/money.ts`](src/utils/money.ts) and mirrored byte-for-byte in the mobile
app so the two can never disagree.

---

## Setup

```bash
cp .env.example .env     # then fill in DATABASE_URL and MOCK_API_URL
npm install
npm run migrate          # create the schema
npm run seed             # import the catalog from the mock API
npm run dev              # http://localhost:3000
```

No Postgres handy? Seed the bundled catalog instead and skip the network:

```bash
npm run seed:fixture
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server via `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Import the catalog from `MOCK_API_URL` |
| `npm run seed:fixture` | Import `fixtures/mock-catalog.json` (offline) |
| `npm run inspect:mock` | Probe `MOCK_API_URL` and print what it actually returns |
| `npm run typecheck` | `tsc --noEmit`, tests included |
| `npm test` | Unit + end-to-end tests (needs `DATABASE_URL`) |

---

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | TLS is enabled automatically for hosted Postgres and skipped for localhost and `*.railway.internal` |
| `MOCK_API_URL` | for seeding | — | Base URL of the Dripos mock API |
| `PORT` | no | `3000` | Injected by Railway |
| `HOST` | no | `0.0.0.0` | Must bind all interfaces on a PaaS |
| `NODE_ENV` | no | `development` | |
| `LOG_LEVEL` | no | `info` | |
| `RUN_MIGRATIONS_ON_START` | no | `true` | Advisory-locked, so concurrent deploys can't race |
| `SEED_ON_START` | no | `false` | Costs an outbound fetch per cold start |
| `ADMIN_TOKEN` | in production | — | Bearer token for `POST /admin/seed`. Without it, that route is **disabled** in production rather than left open |

---

## API

Every error response is `{ "error": "...", "code": "SNAKE_CASE" }`, plus context where
it helps the client.

### `GET /health` → `200`
`{ "ok": true }`. Does not touch the database, so it stays a true liveness probe.

### `GET /health/ready` → `200` / `503`
Readiness — actually queries Postgres.

### `GET /products` → `200`
The menu, with modifier groups and options nested inline.

```json
[
  {
    "id": "uuid",
    "name": "Iced Coffee",
    "priceCents": 450,
    "modifierGroups": [
      {
        "id": "uuid",
        "name": "Size",
        "required": true,
        "options": [{ "id": "uuid", "name": "Large", "priceDeltaCents": 75 }]
      }
    ]
  }
]
```

This is **one** database round trip, via lateral `json_agg`. Adding a product never
adds a query.

### `POST /tickets` → `201`

```json
{
  "items": [{ "productId": "uuid", "quantity": 2, "selectedModifierOptionIds": ["uuid"] }],
  "subtotalCents": 900,
  "taxCents": 80,
  "totalCents": 980
}
```

**The server does not trust these totals.** It reprices the whole ticket from the
database and compares. Any difference — even one cent — is rejected:

| Code | Status | Cause |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed schema validation |
| `PRODUCT_NOT_FOUND` | 404 | Unknown `productId` |
| `MODIFIER_OPTION_NOT_FOUND` | 404 | Unknown modifier option |
| `MODIFIER_NOT_AVAILABLE_FOR_PRODUCT` | 422 | Option belongs to a different product |
| `MULTIPLE_SELECTIONS_IN_GROUP` | 422 | Two picks from one single-select group |
| `REQUIRED_MODIFIER_MISSING` | 422 | A required group has no selection |
| `NEGATIVE_UNIT_PRICE` | 422 | Discounts drove the unit price below zero |
| `TOTAL_MISMATCH` | 422 | Client arithmetic disagrees with the server |

`TOTAL_MISMATCH` returns both `expected` and `received` so the client can show
something useful instead of a generic failure.

Repricing costs 3 queries regardless of how many line items are on the ticket, and
the insert runs in a single transaction.

### `POST /tickets/:id/pay` → `200`

```json
{ "paymentMethod": "cash", "amountTenderedCents": 1000 }
```

Returns the ticket with `status: "paid"` and `changeDueCents`.

| Code | Status | Cause |
|---|---|---|
| `UNSUPPORTED_PAYMENT_METHOD` | 400 | Only `cash` is implemented |
| `TICKET_NOT_FOUND` | 404 | No such ticket |
| `TICKET_NOT_OPEN` | 409 | Already paid or voided |
| `INSUFFICIENT_TENDER` | 422 | Tendered less than the total |

Payment is an atomic compare-and-set (`UPDATE ... WHERE status = 'open'`), so two
concurrent requests cannot both succeed. There is a test for exactly that.

### `GET /tickets?limit=50&offset=0` → `200`
Newest first. `limit` defaults to 50, caps at 100. `itemCount` is the summed quantity.
Returns `{ tickets, total }`.

### `GET /tickets/:id` → `200`
Full ticket with items and their selected modifiers.

### `POST /admin/seed` → `200`
Re-imports the catalog. Idempotent. Requires `Authorization: Bearer $ADMIN_TOKEN`
whenever `ADMIN_TOKEN` is set, and is disabled outright in production when it isn't.

---

## Schema notes

- `external_id` on every seeded table makes re-seeding idempotent.
- Ticket rows **snapshot** `product_name`, `product_price_cents`,
  `modifier_option_name` and `price_delta_cents`. A receipt printed a year from now
  still shows what the customer actually paid, even if the menu has changed since.
- Money integrity is enforced by the database, not just the application:
  `total = subtotal + tax`, `line_total = unit_price × quantity`, and a `paid`
  ticket must carry a complete, self-consistent payment record.
- Migrations are forward-only, tracked in `schema_migrations`, and guarded by a
  Postgres advisory lock so simultaneous container boots can't race.

---

## Deploy (Railway)

1. New service from this repo, **Root Directory** `backend`.
2. Add a Postgres database to the project.
3. Set variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `MOCK_API_URL` = the mock API base URL
   - `NODE_ENV` = `production`
   - `ADMIN_TOKEN` = any long random string
4. Deploy. [`railway.json`](railway.json) supplies the build and start commands and
   points the healthcheck at `/health`.
5. Generate a public domain, then seed once:

```bash
curl -X POST https://<your-domain>/admin/seed -H "Authorization: Bearer $ADMIN_TOKEN"
```

Migrations run automatically on boot, so there is no separate release step.

---

## Tests

```bash
DATABASE_URL=postgresql://localhost:5432/dripos_test npm test
```

45 tests: money arithmetic as pure units, and the full API end to end against a real
Postgres — happy path, every rejection code, pagination edges, and the concurrent
double-payment race.
