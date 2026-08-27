<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-context -->

## What this is
Expense-Management-web-app: Next.js 16 (App Router, Turbopack, TS
strict, Tailwind v4) web port of the Scantrix mobile app (Expo/React
Native, repo Scantrix_v2). Ported logic layer (auth/invoice/vendor/
quickBooks) lives in src/store/ (Redux Toolkit slices + thunks) and
src/lib/ (api client, storage, firebase, quickbooks). Building the UI
that consumes them is the current work.

## Architecture
- src/store/ — Redux slices + *Api.ts thunk files, mirrors the mobile
  app's redux/ structure exactly. Don't invent a new state pattern.
- src/lib/ — platform-agnostic logic (api client, storage, session,
  firebase, quickbooks connect/post). Every browser-only call
  (localStorage, window) inside these files is individually guarded
  with `typeof window !== 'undefined'` — this project has already had
  one real SSR prerender crash from an unguarded call. Keep that
  pattern for any new file here.
- App Router default is Server Components. Add 'use client' only for
  hooks/event handlers/browser APIs, on the smallest leaf component,
  never on a page or layout root.
- Backend URLs and Firebase config come from env vars
  (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_QUICKBOOKS_API_URL) with fallbacks
  to the known-working hardcoded values — see .env.local.example.
  Never hardcode a new URL inline.

## Build & verify
- Typecheck: `npx tsc --noEmit`
- Full gate (required, not optional — tsc alone misses SSR failures):
  `npx tsc --noEmit && npx next build`
- Tests: `npm test` (node:test via tsx, `src/test/*.test.ts`). 270 tests.
  An earlier version of this file claimed no test suite existed; that was stale.

## During an active LOOP.md run
If LOOP.md and TASKS.md exist at repo root and a loop is in progress,
their guardrails take precedence over anything in this file if the two
ever conflict.

<!-- END:project-context -->
