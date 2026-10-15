# Dripos Lite — Mobile

Expo + React Native point-of-sale client: browse the menu, customise a drink, take
cash, print a receipt.

**Runs in Expo Go.** No custom native modules, no development build, no Xcode.

---

## Setup

```bash
cd apps/mobile
cp .env.example .env.local     # then set EXPO_PUBLIC_API_URL
npm install
npx expo start                 # scan the QR code with Expo Go
```

`EXPO_PUBLIC_API_URL` is the only configuration this app needs.

> **Running the backend locally?** Use your machine's LAN IP
> (`http://192.168.1.50:3000`), not `localhost` — on your phone, `localhost` means
> the phone. `EXPO_PUBLIC_*` values are inlined at bundle time, so after changing
> `.env.local` restart with `npx expo start --clear`.

---

## Structure

```
app/                         # file-based routes (expo-router)
├── _layout.tsx              # providers, fonts, splash, root stack
├── (tabs)/
│   ├── _layout.tsx          # Menu | Cart (badge) | Tickets
│   ├── index.tsx            # menu
│   ├── cart.tsx             # cart
│   └── tickets/             # nested stack: list + detail
├── product/[id].tsx         # customisation modal
├── checkout.tsx
└── receipt/[ticketId].tsx

src/
├── theme/                   # colours, type scale, spacing, radii
├── components/              # Button, states, badge, stepper, totals
├── lib/                     # api client, money, query hooks
├── store/cart.ts            # Zustand cart
└── types/api.ts             # backend contract
```

---

## How it works

**Money.** Integer cents everywhere. `src/lib/money.ts` is character-identical to
`backend/src/utils/money.ts`, enforced by `npm run check:shared` at the repo root —
the client computes the totals it submits and the server recomputes and rejects any
disagreement, so the two must not drift.

**Cart.** A Zustand store whose totals are derived, never assigned. Every action
rebuilds the item list and pipes it through one `withTotals` function, so the store
cannot end up internally inconsistent. Adding an item that matches an existing line
— same product, same set of options — bumps that line's quantity instead of adding
a duplicate.

**Server state.** TanStack Query. The customisation modal reads its product out of
the cached `/products` response rather than refetching. React Query's focus
refetching is browser-oriented, so `app/_layout.tsx` drives it from `AppState`.

**Errors.** The API client surfaces the backend's `{ error, code }` envelope, so a
rejected order shows the real reason rather than "HTTP 422". Every data screen
handles loading, error (with retry), empty, and success.

---

## Split tender

| Concern | Where |
|---|---|
| Payment in progress (persisted) | `src/store/payment.ts` |
| Checkout hub: tenders taken, balance | `app/checkout/index.tsx` |
| Entering one tender | `app/checkout/tender.tsx` |
| Balance/change arithmetic | `src/lib/money.ts` → `applyTenderCents` |

Collecting an amount is a route of its own. That is the whole mechanism behind
the back-button requirement: the half-typed amount exists only on that screen,
so dismissing it discards that entry and leaves confirmed tenders alone. No
custom interception, no dirty-state prompt — just ordinary navigation.

The session is persisted for the same reason the offline queue is: cash already
in the drawer must survive the app dying mid-split. It is keyed to the cart
total, so changing the order starts the payment over rather than applying tenders
to a total they were never taken against.

Each tender carries its own UUID. Sync replays the whole set under those keys,
so an interrupted sync resends everything and the server records each tender
once.

## Offline support

| Concern | Where |
|---|---|
| Durable queue of offline sales | `src/store/queue.ts` |
| Drain logic and retry classification | `src/lib/sync.ts` |
| Connection state + simulate-offline switch | `src/store/connectivity.ts` |
| Menu caching and fallback | `src/lib/queries.ts` |
| Startup, reconnect and foreground triggers | `src/lib/runtime.ts` |
| Persistence | `src/lib/storage.ts` (AsyncStorage) |

**Taking a sale offline.** Checkout builds a complete snapshot — product names,
modifiers, unit prices, tender and change — mints a UUID for it, and writes it to
disk *before* reporting success. The receipt renders from that snapshot, so it
appears instantly with no server.

**Falling back, not failing.** If an online submit dies on a network error or a
timeout, the sale is queued rather than lost. Any other error (a rejected total,
a missing product) is a real problem and is shown to the cashier.

**Retry policy.** Network errors, timeouts and 5xx leave a sale pending for the
next attempt. A 4xx means the server will say the same thing forever, so the
sale is parked as `failed`, surfaced in the ticket list with its reason, and
retried only when asked from Settings.

**Crash recovery.** A sale left mid-sync is reset to pending on next launch.
Replaying is safe because the key never changes.

### Demonstrating it

Settings → **Simulate offline**. The banner appears, the menu keeps working from
cache, checkout completes and prints a receipt marked "Pending sync", and the
Tickets tab shows a badge. Switch it back off and the queue drains on its own.

Force-quitting the app with sales queued and reopening it is the interesting
case: the count survives, and syncing still produces one ticket each.

### Not persisted

The in-progress cart is intentionally not written to disk — only completed sales
are. Closing the app mid-order loses the cart, which is recoverable by re-ringing
it; losing a sale already paid for in cash is not.

```bash
npm test        # 14 tests covering the queue, sync and idempotency
```

## Deliberate deviations from the original spec

**Expo SDK 57, not 51.** Expo Go on the App Store and Play Store only runs the
newest SDK. An SDK 51 build would not open when a reviewer scans the QR code. All
native-module versions are pinned to Expo's own SDK 57 compatibility manifest
rather than npm `latest` — `latest` currently resolves TypeScript 7, React 19.3 and
React Native 0.87, which this SDK's Metro rejects.

**A ~60-line fetch client instead of `ky`.** `ky` v2 is pure ESM targeting Node 22
and is not validated against Hermes/Metro. The replacement is smaller than the
dependency, has no bundler risk, and types the backend's error envelope properly.

**Google Fonts instead of the licensed brand faces.** Roslindale, PP Neue Montreal
and PP Fraktion Mono are commercial. The style guide names open-source stand-ins,
so this uses Playfair Display, DM Sans and DM Mono. Swapping in the real families
is a change to `src/theme/typography.ts` alone.

**No `react-native-reanimated`.** It is an optional peer of expo-router and nothing
here needs it. Dropping it removes the `react-native-worklets` babel plugin and one
more thing that can break a first run.

---

## Accessibility

- Every control has a role and a label; the quantity stepper and Add to Cart also
  carry hints.
- Touch targets are at least 44×44pt.
- Disabled payment methods expose `accessibilityState.disabled` and read as
  "coming soon" rather than being silently inert.
- Status badges pair colour with an icon and a word, so they survive greyscale and
  colour vision deficiency.

---

## Checks

```bash
npm run typecheck     # tsc --noEmit, strict
```
