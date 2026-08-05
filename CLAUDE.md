# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"El Pampa" — a single-vendor produce store (verdulería) storefront + admin panel, in Spanish (Argentina). Next.js 15 (App Router) + TypeScript, deployed on Vercel, with Supabase Postgres (via Prisma) as the database and Supabase Storage for product images.

## Commands

```bash
npm install
npm run dev              # local dev server at http://localhost:3000
npm run build             # runs `prisma generate` then `next build`
npm run start              # serve production build
npx prisma migrate dev --name <name>   # create/apply a migration locally
npm run prisma:deploy               # `prisma migrate deploy`, run in production before first deploy
node prisma/seed.js         # optional: seeds 3 sample products
node scripts/fill-product-images.js [--apply] [--all] [--id=N]  # optional: fills placeholder product images from Pexels, see script header
```

There is no lint script, no test runner, and no Tailwind config configured in this project — don't assume `npm run lint` or `npm test` exist, and don't reach for Tailwind utility classes (styling is plain CSS, see below).

### Environment

Copy `.env.example` to `.env` and fill in values. Key vars: `DATABASE_URL` (Supabase pooler, transaction mode) / `DIRECT_URL` (pooler, session mode, used by Prisma migrations), `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `JWT_SECRET` (admin auth), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` (image uploads), and store-specific display vars (`STORE_NAME`, `TRANSFER_ALIAS`, `TRANSFER_CBU`, `WHATSAPP_NUMBER`, etc. — see `src/lib/site.ts` for defaults/fallbacks).

## Architecture

**Two front-of-house surfaces, one backend.** `src/components/storefront-page.tsx` (route `/`) is the public store; `src/components/admin-panel-page.tsx` (route `/panel`, gated by `/login`) is the owner's admin UI. Both are client components (`'use client'`) that hold all state in local `useState`/`useEffect` — there is no global state library (no Redux/Zustand) and no data-fetching library (no React Query/SWR); components just call `fetch()` against the route handlers directly.

**API lives entirely in Next.js route handlers** under `src/app/api/**/route.ts` (all `export const runtime = 'nodejs'`) — there is no separate Express/Node server. Public endpoints: `GET /api/products` (auto-seeds 3 default products if the table is empty, and falls back to hardcoded products on DB error so the storefront never fully breaks), `GET /api/store-info`, `POST /api/checkout`. Admin endpoints live under `/api/admin/*` and all start with `verifyAdminAuth(request.headers.get('authorization'))` from `src/lib/auth.ts` — a short-circuit pattern (`if (!auth.ok) return auth.response`) used at the top of every admin handler.

**Auth is a single shared-secret admin login**, not per-user accounts: `POST /api/admin/login` checks `username`/`password` against `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars and returns a JWT (`src/lib/auth.ts`, 12h expiry, `role: 'admin'`). The panel stores this token in `localStorage` (see `login-page.tsx` / `admin-panel-page.tsx`) and sends it as `Authorization: Bearer <token>` on every admin request. There are no user accounts, sessions, or refresh tokens.

**Data model is intentionally small** (`prisma/schema.prisma`): `Product` (name, price, image URL, `unit` — one of `kg`/`g`/`unidad`, no manual stock tracking) and `Order` (`items` is a denormalized `Json` snapshot of cart contents at checkout time, plus `total`/`status`/optional customer info). Order `status` lifecycle is `pending → paid` or `pending → cancelled/failed`, driven by the admin panel's confirm/cancel actions (`/api/admin/orders/[id]/confirm`, `/api/admin/orders/[id]/cancel`) — there is no automated payment webhook; checkout is manual bank transfer and the owner confirms payment by hand after checking their account.

**Product units drive quantity math app-wide** — `src/lib/product-units.ts` is the single source of truth for valid units, default/step quantities per unit (e.g. kg steps by 0.25, grams/unidad step by whole numbers), and formatting/normalizing quantities. Any code touching cart quantities or product forms should go through these helpers rather than reimplementing rounding logic.

**Product image uploads bypass Prisma** — `POST /api/admin/upload-product-image` talks to the Supabase Storage REST API directly with `fetch` (using the service role key), lazily creating/publicizing the bucket on first use, rather than going through a Supabase JS SDK client. Images are compressed client-side to WebP before upload (per README) to save storage.

**Validation is manual and centralized per-entity**: `src/lib/validation.ts` (`parseProductPayload`) validates/normalizes raw request bodies for product create/update (including a `partial` mode for PATCH-like updates), throwing plain `Error`s with user-facing Spanish messages that route handlers catch and return as 400s. Follow this pattern (manual parse function + thrown Error + catch-and-400) for new admin-mutation endpoints rather than introducing a schema library.

**Styling is plain CSS**, not Tailwind: `src/app/globals.css` defines a themed palette via CSS custom properties (`--chalkboard`, `--leaf`, `--crate`, `--paper`, etc. — an earthy produce-market look) and utility-ish classes like `.container`. Match this existing custom-property system for new UI rather than introducing a CSS framework.

**`src/lib/site.ts`** (`siteConfig`) centralizes store display info (name, address, hours, transfer details, WhatsApp number) read from env vars with hardcoded Spanish-language fallbacks — used for page metadata/SEO (`layout.tsx`, `page.tsx` inject JSON-LD `GroceryStore` structured data) and in checkout confirmation responses.

## Conventions

- All user-facing strings, error messages, and comments in existing code are in Spanish (Argentina) — match this for new code/messages.
- Route handler pattern: `export const runtime = 'nodejs'` + auth check (if admin) + `try/catch` wrapping Prisma calls + `console.error('Error en <method> <path>:', error)` on failure, returning `NextResponse.json({ error: '...' }, { status })`.
- Dynamic route params are async (`context: { params: Promise<{ id: string }> }`, Next 15 style) — always `await context.params`.

## Git

This is a single-owner repo (Joaquin). When the user explicitly asks in the conversation to commit/push, `git push` to the current working branch is pre-authorized — no need to ask again for that specific request. Pushing to `main`, force-pushing, or pushing when the user hasn't asked still requires explicit confirmation in the moment.
