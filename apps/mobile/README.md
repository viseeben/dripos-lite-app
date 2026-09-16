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
