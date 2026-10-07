# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"El Pampa" — a single-vendor produce store (verdulería) storefront + admin panel, in Spanish (Argentina). Next.js 15 (App Router) + TypeScript, deployed on Vercel (functions pinned to `gru1`, same region as the DB), with Supabase Postgres (via Prisma) as the database and Supabase Storage for product images. No online payments: customers pay by bank transfer (once the store confirms the final weighed total) or cash on delivery/pickup.

## Commands

```bash
npm install
npm run dev              # local dev server at http://localhost:3000
npm run build            # runs `prisma generate` then `next build`
npm run start            # serve production build
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint 9 flat config (next/core-web-vitals + next/typescript)
npm test                 # Vitest unit tests (src/**/*.test.ts), no DB needed
TEST_DATABASE_URL=postgresql://…/elpampa_test npm run test:integration   # route handlers against a real Postgres (tests/integration)
npm run check:bundle     # after a build: fails if server env var names/values leak into .next/static
npm run check:pages      # after a build: starts `next start` and scans HTML, RSC payloads and API responses for the same leaks
npx prisma migrate dev --name <name>   # create/apply a migration locally
npm run prisma:deploy    # `prisma migrate deploy` by hand (production builds already run it, see Deploy below)
node prisma/seed.js      # optional: seeds 3 sample products (the API never seeds)
python3 -m unittest scripts/test_actualizar_precios.py   # tests of the Python price-update script
```

Integration tests create/migrate the DB from `TEST_DATABASE_URL` themselves and refuse to run if the DB name doesn't contain "test" (they truncate it). The `anon`/`authenticated` roles must exist (the RLS migration revokes from them). CI (`.github/workflows/ci.yml`) runs all of the above plus `npm audit --omit=dev --audit-level=high`. There is no Prettier and no Tailwind — styling is plain CSS (see below).

### Environment

Copy `.env.example` to `.env` and fill in values. Key vars: `DATABASE_URL` (Supabase pooler, transaction mode, `pgbouncer=true&connection_limit=1`) / `DIRECT_URL` (pooler, session mode, used by migrations), `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `JWT_SECRET` / `ADMIN_TOKEN_VERSION` (admin auth), `CRON_SECRET` (daily cleanup cron), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` (image uploads), and store-specific vars (`STORE_NAME`, `TRANSFER_ALIAS`, `WHATSAPP_NUMBER`, `DELIVERY_FEE`, `DELIVERY_MIN_PURCHASE`, `DELIVERY_FREE_THRESHOLD`, `GOOGLE_REVIEW_URL`, etc. — see `src/lib/site.ts`). The example secrets from `.env.example` are rejected at runtime.

## Architecture

**Two front-of-house surfaces, one backend.** The public store is `src/components/storefront-page.tsx` (orchestrator) + `src/components/storefront/**` (hooks like `use-cart.ts`, `use-checkout-form.ts`, `use-delivery-slots.ts`, and components). The cart drawer + checkout are loaded lazily (`next/dynamic`, preloaded on the first add or when hovering/touching the cart button) so they're not in the initial chunk; the catalog is rendered complete in the HTML (cards past the initial limit are collapsed with CSS). It is rendered by Server Components (`src/app/page.tsx` and the category landings `/bolsones`, `/ofertas`, `/frutas`, `/verduras` via `src/components/category-landing.tsx`), which pass `initialProducts` and `storeInfo` (from `getPublicStoreInfo()`) as props — the storefront does NOT fetch the catalog or store info on load. The admin UI is `src/components/admin-panel-page.tsx` + `src/components/admin/**` (route `/trastienda/gestion`, login at `/trastienda`; paths in `src/lib/routes.ts`). Both are client components with local `useState`/`useEffect` — no global state library, no data-fetching library; they `fetch()` route handlers directly.

**API lives entirely in Next.js route handlers** under `src/app/api/**/route.ts` (all `export const runtime = 'nodejs'`). Public: `GET /api/products` (cached catalog; never writes to the DB, 500 on error), `GET /api/store-info`, `POST /api/checkout`. Cron: `GET /api/cron/limpiar-pedidos` (Vercel Cron, `Authorization: Bearer ${CRON_SECRET}`; cancels open orders older than 7 days except cash, already-weighed or legacy Mercado Pago (`mpPreferenceId`) ones, deletes only orders cancelled more than 90 days ago by `updatedAt`, never touches paid, never cancels and deletes in the same run). Panel lists: `GET /api/gestion/orders?date=` (created that day, slot that day by id range, or pickups created the previous day after `pickupCutoffMinutes`) and `GET /api/gestion/orders/atrasados` (open orders from previous days). Admin endpoints live under `/api/gestion/*` and all start with `const auth = verifyAdminAuth(request); if (!auth.ok) return auth.response;` then `enforceRateLimit(...)`. Products are read through `getCachedProducts()` in `src/lib/products.ts`; admin mutations must call `invalidarProductos()`. `src/middleware.ts` sets a nonce-based CSP (no external CDNs), HSTS, same-origin CORS, and rejects mutating `/api/gestion` requests whose `Sec-Fetch-Site` isn't `same-origin`; that's why the root layout is `force-dynamic`.

**Checkout contract** (`POST /api/checkout`): body `{ cart: [{id, quantity, price}], deliveryMethod, deliverySlot, paymentMethod, customer, idempotencyKey }`. The server recomputes everything with DB prices: 200 `CheckoutResponse` (with `priceDrops` when a price only went down — charged at the lower price); 409 `PRECIOS_CAMBIARON` (with all `priceChanges`) when a price went up or a drop would make the total higher / fall below the delivery minimum, or `SIN_STOCK` (with `unavailableIds`), without creating the order; 400 `TURNO_NO_DISPONIBLE` (with `availableSlots`) or a plain `{error}`; 429 per-phone cap (5 orders / 24 h) or attempt/creation rate limits, 503 global cap (150 orders / hour, cancelled excluded). An existing `idempotencyKey` returns the original order before any price/slot validation. Response types are in `src/lib/types.ts`.

**Auth is a single shared-secret admin login**, not per-user accounts: `POST /api/gestion/login` checks `ADMIN_USERNAME`/`ADMIN_PASSWORD` and sets an `httpOnly; Secure; SameSite=Strict; Path=/api/gestion` cookie (`elpampa_admin`) with a 12h HS256 JWT carrying `v = ADMIN_TOKEN_VERSION` (`src/lib/auth.ts`). The panel never sees the token: it calls `GET /api/gestion/session` to check it and `POST /api/gestion/logout` to clear it. Changing `ADMIN_TOKEN_VERSION` (and redeploying) revokes all sessions. No user accounts, refresh tokens or Authorization headers.

**Pricing, shipping and slots are pure shared logic** — use these, don't reimplement:
- `src/lib/pricing.ts`: `getEffectivePrice` / `isOfferActive` (offers = `offerPrice` < `price`, optional `offerEndsAt`), `roundMoney`, `computeTotals` (fixed `deliveryFee`, free from `deliveryFreeThreshold`, minimum on the subtotal), `buildOrderLines`, `detectPriceChanges`. The cart uses them for instant totals; the checkout re-runs them server-side.
- `src/lib/delivery-slots.ts`: delivery windows (13–14 h and 19–20 h), offered only inside the store's opening hours and with 60 min lead time; slot ids are `"YYYY-MM-DDTHH"`; `findAvailableSlot` is re-checked on the server. Slots are computed only on the client after mount. The first render uses the server's time (`renderedAt` prop) and the client clock is corrected if it's off by more than 2 minutes, so offers/slots never cause hydration mismatches.
- `src/lib/store-hours.ts` is the single source of truth for opening hours (display text, JSON-LD, "abierto ahora", slots, pickup cutoff `pickupCutoffMinutes` — 19:00 or closing time if earlier — and `describePickupReady`).
- `src/lib/product-units.ts`: units `kg`/`g` (weight, 50 g precision, kg↔g toggle in the cart) and `unidad`/`atado`/`bandeja` (integers). Always use `isWeightUnit()`, never compare to `'unidad'`.

**Data model** (`prisma/schema.prisma`): `Product` (name, price, image, `unit`, `category` — Bolsones/Frutas/Verduras/Almacén/Ofertas —, `description`, `offerPrice`, `offerEndsAt`, `available`, `updatedAt`) and `Order` (`items` is a denormalized `Json` snapshot `[{id,name,price,quantity,unit}]`; `subtotal`, `shippingCost`, `total`; `status` is text constrained by the `Order_status_check` CHECK to pending/paid/cancelled/failed (not an enum, so old and new code both work during a deploy); `deliveryMethod`, `paymentMethod` transfer/cash, `deliverySlot`, `adjustedAt`; customer name/phone/address/notes/`replacementPolicy`; unique `idempotencyKey`; `mpPreferenceId`/`mpPaymentId` are legacy, unused). For weighed items the total is an estimate until the owner adjusts real weights (`PUT /api/gestion/orders/[id]` with `{ items, expectedUpdatedAt }`: uses the stored item prices, keeps the original shipping, `normalizeWeighedQuantity` 5 g precision, 409 if the order changed since the editor opened). "Avisar total final" stays disabled until weights are adjusted. Status changes (confirm/cancel/adjust) use conditional `updateMany` so they never overwrite a status that changed meanwhile; `failed` orders can still be confirmed/cancelled/adjusted. Option labels live in `src/lib/order-options.ts`, order serialization/adjustment helpers in `src/lib/order-lifecycle.ts`.

**Deploy and migrations**: the production build (`npm run build` on Vercel with `VERCEL_ENV=production`) runs `scripts/migrate-on-production.mjs`: `prisma migrate deploy` with `DIRECT_URL`, then runs `scripts/verificar-esquema.sql` through PrismaClient against `DATABASE_URL` (the runtime DB), which fails the build if a column/constraint/index the code needs is missing (migrate deploy doesn't notice a migration applied with different content, nor a `DIRECT_URL` pointing at another DB). It fails closed: no `DIRECT_URL`/`DATABASE_URL`, or no `VERCEL_ENV` while it looks like Vercel (`VERCEL=1` or cwd under `/vercel/`) or `DIRECT_URL` is exported (allowed in GitHub Actions or with `MIGRACIONES_EN_BUILD=no`), so a failed migration keeps the previous deployment live. It also warns (without failing) about `public` functions that anon/authenticated can execute. Previews never migrate. Migrations must stay backward compatible (old code keeps serving during the build). When a migration adds something the code relies on, add it to `verificar-esquema.sql` too. Legacy rows from the pre-checkout version (`paymentMethod` null, `subtotal` 0, shipping charged apart unless the subtotal reached the free-shipping threshold, Mercado Pago links exposed only as `mercadoPagoLink: boolean`) are handled in `toOrderRecord`/`isShippingChargedApart`/`shippingLabel`; the checkout answers old-format bodies (no `customer`) with a "recargá la página" 400.

**Database security**: Supabase exposes `public` through its REST API with the public anon key; the app doesn't use it (Prisma connects as the table owner). Every table has RLS enabled with no policies and `anon`/`authenticated` have no privileges (functions included). Any migration that creates a table must `ENABLE ROW LEVEL SECURITY`; one that creates a function in `public` must `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. `tests/integration/rls.test.ts` fails otherwise.

**Product image uploads bypass Prisma** — `POST /api/gestion/upload-product-image` talks to the Supabase Storage REST API with `fetch` (service role key), validates JPG/PNG/WebP by magic bytes (max 4 MB, read with a byte counter), and checks/creates the bucket once per instance. Images are compressed client-side to WebP (max 800 px) before upload.

**Validation is manual and centralized**: `src/lib/validation.ts` (`parseProductPayload` with a `partial` mode, `parseCustomerPayload`, checkout parsers, bulk and order-adjustment parsers) and `src/lib/sanitize.ts` (`sanitizeText`, `sanitizeNumber` — decimal strings only —, `sanitizeId` — positive INT4 only). They throw `ValidationError`s with user-facing Spanish messages that route handlers catch and return as 400s. Only `ValidationError` messages go back to the client — any other error (e.g. Prisma) is logged and answered with a generic 500. Follow this pattern for new endpoints rather than introducing a schema library.

**Styling is plain CSS**, not Tailwind: `src/app/globals.css` (storefront and legacy panel styles) and `src/components/admin/admin.css` (panel) use the themed custom properties (`--chalkboard`, `--leaf`, `--crate`, `--paper`, etc.). Fonts come from `next/font` as `var(--font-display)` / `var(--font-body)` / `var(--font-mono)`; icons are `lucide-react` plus `src/components/brand-icons.tsx` (WhatsApp, Instagram). No Font Awesome, no external CSS/font CDNs (the CSP doesn't allow them).

**`src/lib/site.ts`** (`siteConfig`, server-only) centralizes store info from env vars with Spanish fallbacks; client components receive the public subset as `StoreInfo` props (`getPublicStoreInfo()`) or from `/api/store-info` (panel). SEO lives in `src/lib/seo.ts` (JSON-LD `GroceryStore`, `Offer` with `UnitPriceSpecification`, `FAQPage`, `BreadcrumbList`, `serializeJsonLd` which escapes `<`), plus `sitemap.ts`, `robots.ts` and `llms.txt`.

**Price-update script**: `scripts/actualizar_precios.py` (Python + pandas) matches a wholesale price list against the catalog and applies per-category margins through `POST /api/gestion/products/bulk` (dry run by default, `--aplicar` to write; https only). If you change units, categories, the bulk contract or the session cookie, update the script and its tests too.

## Conventions

- All user-facing strings, error messages, and comments are in Spanish (Argentina) — match this for new code/messages.
- Route handler pattern: `export const runtime = 'nodejs'` + auth check (if admin) + rate limit + `try/catch` wrapping Prisma calls + `console.error('Error en <method> <path>:', error)` on failure, returning `NextResponse.json({ error: '...' }, { status })`. Prisma `P2025` → 404.
- Dynamic route params are async (`context: { params: Promise<{ id: string }> }`, Next 15 style) — always `await context.params` and parse with `parseNumericId`.
- Money is formatted with `formatArs` (never `toFixed(2)`), quantities with `formatProductQuantity`.
- Server-only modules (`auth.ts`, `prisma.ts`, `products.ts`) import `'server-only'`; never import them (or `site.ts`) from a `'use client'` component.
- New logic that decides money, dates or permissions gets unit tests; new endpoints get integration tests (see `tests/integration/helpers.ts`).

## Git

This is a single-owner repo (Joaquin). When the user explicitly asks in the conversation to commit/push, `git push` to the current working branch is pre-authorized — no need to ask again for that specific request. Pushing to `main`, force-pushing, or pushing when the user hasn't asked still requires explicit confirmation in the moment.
