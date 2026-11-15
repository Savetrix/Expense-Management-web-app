# Savetrix MCP Server — How We Built It

A step-by-step record of building the Savetrix MCP server: a Model Context
Protocol server that exposes the Savetrix / ScanTrix invoice app (auth,
invoices, vendors, GL accounts, tax codes, QuickBooks, team, subscriptions)
to AI assistants like Claude Desktop.

- **Repo:** https://github.com/KunjShah95/sahajta-mcp-scantrix/tree/mcp
- **API:** https://api.savetrix.com/api
- **Web app (sign-in):** https://scantrix.ai
- **Tools exposed:** 32 `savetrix_*` tools
- **Transports:** stdio (Claude Desktop) + HTTP (server deployments)

---

## 1. What an MCP server is (and why)

MCP (Model Context Protocol) lets an AI assistant call your app's operations
as **tools**. The assistant sees a tool list, picks one, sends typed args, and
gets a result back. We wrapped the existing Savetrix REST API so Claude can
"do invoice work" conversationally.

Two ways the assistant talks to the server:

- **stdio** — Claude Desktop spawns `node dist/index.js` and speaks MCP over
  stdin/stdout. This is what "normal Claude" (the desktop app) uses.
- **HTTP** — `node dist/index.js --http` runs an Express server on a port;
  clients POST MCP messages to `/mcp`. Used for hosted/testing setups.

---

## 2. Project scaffold

```
mcp-server/
├── src/
│   ├── client/            # thin wrappers over the Savetrix REST API
│   │   ├── savetrixClient.ts   # axios instance + auth/refresh/QB-id logic
│   │   ├── auth.ts, invoices.ts, vendors.ts, accounts.ts,
│   │   ├── taxcodes.ts, team.ts, quickbooks.ts, subscription.ts
│   │   └── unwrap.ts           # response unwrapping helper
│   ├── tools/
│   │   ├── index.ts       # registers all 32 MCP tools (buildServer)
│   │   ├── schemas.ts     # Zod input schemas per tool
│   │   └── gates.ts       # requireConfirm() for destructive ops
│   ├── servers/
│   │   ├── stdioServer.ts # stdio transport
│   │   └── httpServer.ts  # Express + /mcp + /healthz
│   ├── test/              # node:test unit/integration tests
│   ├── scripts/smoke.ts   # spawns server, lists tools
│   ├── config.ts          # env + CLI arg + config-file parsing
│   ├── session.ts         # file-based token persistence
│   └── index.ts           # entrypoint: loadConfig -> stdio or http
├── package.json
├── tsconfig.json
└── .env.example
```

Dependencies: `@modelcontextprotocol/sdk`, `axios`, `express`, `zod`,
`form-data`, `dotenv`. Dev: `tsx`, `typescript`, `@types/*`,
`axios-mock-adapter`.

`package.json` scripts:

```
typecheck : tsc --noEmit
build     : tsc               # emits dist/
start     : node dist/index.js
dev       : tsx src/index.ts
test      : node --import tsx --test src/test/*.test.ts
smoke     : tsx src/scripts/smoke.ts
```

---

## 3. Build order (the actual sequence)

### Step 1 — Config (`config.ts`)
Parse settings from **env vars → config file → defaults**, in that order.
Keys: `SAVETRIX_API_URL`, `SAVETRIX_WEB_URL`, `SAVETRIX_EMAIL`/`PASSWORD`,
`SAVETRIX_QB_CONNECTION_ID`, `SAVETRIX_MCP_API_KEY`, `SAVETRIX_PORT`.
CLI flags: `--http`, `--port`, `--config`.

### Step 2 — Session store (`session.ts`)
Persist `{ accessToken, refreshToken, user, email }` to
`.savetrix-mcp/config.json`. Tolerates missing/corrupt file (returns `{}`).
This is why login survives across tool calls and restarts.

### Step 3 — API client (`savetrixClient.ts`)
One axios instance with two interceptors:
- **request:** attach `Authorization: Bearer <token>` + `X-QB-Id` (the active
  QuickBooks company, auto-resolved from `/qb-connections` if not pinned).
- **response:** on `401`, call `/auth/refresh-token` once, save the new token,
  and retry the original request. Re-entrancy guarded so refresh can't loop.

`login()` posts `/auth/login`, stores tokens in the session. `logout()` posts
`/auth/logout` and clears the session.

### Step 4 — Per-resource clients
Small modules that map 1:1 to REST endpoints, e.g. `invoices.listInvoices`,
`quickbooks.getConnectUrl`, `vendors.deactivateVendor`. Keeps `tools/index.ts`
declarative.

### Step 5 — Zod schemas (`schemas.ts`)
Every tool's input is a Zod schema. Destructive tools include a
`confirm: boolean` field; read-only tools omit it.

### Step 6 — Tool registry (`tools/index.ts`)
`buildServer(config)` creates a `McpServer`, one `SavetrixClient`, then
`registerTool(...)` for each of the 32 tools. Two result helpers:
- `text(value)` — JSON-stringified payload (data tools).
- `md(markdown)` — raw markdown (onboarding / link tools).

Destructive tools run through `requireConfirm(args, action)` first and throw a
clear message if `confirm !== true`.

### Step 7 — Transports (`servers/`)
- `stdioServer.ts`: `server.connect(new StdioServerTransport())`.
- `httpServer.ts`: Express app, `POST /mcp` (new transport per request),
  `GET /healthz`, optional `Authorization: Bearer <MCP_API_KEY>` gate.

### Step 8 — Entrypoint (`index.ts`)
`loadConfig(argv)` → if `--http` start Express, else stdio.

---

## 4. The 32 tools

| Group | Tools |
|-------|-------|
| Onboarding | `get_started` |
| Auth | `login`, `logout`, `account_info`, `account_update_profile` |
| Invoices | `invoice_list`, `invoice_get`, `invoice_upload`, `invoice_update`, `invoice_post_to_qb`*, `invoice_reject`* |
| Vendors | `vendor_list`, `vendor_create`, `vendor_update`, `vendor_deactivate`*, `vendor_reactivate` |
| GL accounts | `account_list`, `account_create`, `account_sync` |
| Tax codes | `taxcode_list`, `taxcode_sync` |
| QuickBooks | `qb_status`, `qb_connections`, `qb_set_active`, `qb_connect`, `qb_disconnect`* |
| Team | `team_list`, `team_invite`, `team_remove`* |
| Subscription | `subscription_plans`, `subscription_my`, `subscription_choose`* |

`*` = destructive, requires `confirm: true`.

### Onboarding / sign-in UX
- **`savetrix_get_started`** — detects login + QB state and returns a markdown
  guide with a clickable sign-in link (`https://scantrix.ai`) and, once logged
  in, a clickable QuickBooks authorization link. Call it first when unsure.
- **`savetrix_qb_connect`** — returns a clickable **Authorize QuickBooks** link
  (Intuit OAuth) plus the 3 steps to finish. Built so it works in plain Claude
  Desktop: the user just clicks the link in the chat.

---

## 5. Verify (the gate we run every change)

```bash
npm run typecheck   # tsc --noEmit — clean
npm run build       # emits dist/
npm test            # node:test — 21/21 pass
npm run smoke       # spawns server over stdio — "32 tools listed"
```

Test files: `config.test.ts` (env/arg parsing), `session.test.ts` (token
round-trip + corrupt file), `client.test.ts` (auth + refresh via
axios-mock-adapter), `tools.test.ts` (all tools register), `httpServer.test.ts`
(initialize, tools/list, API-key auth, /healthz).

---

## 6. Live test against production

1. `savetrix_login` with real credentials → tokens acquired, session saved. ✅
2. `savetrix_subscription_plans` (public) → 3 plans returned. ✅
3. `savetrix_qb_status` → "No active QuickBooks connection" before OAuth. ✅
4. `savetrix_qb_connect` → real Intuit OAuth URL generated. ✅
5. QB-scoped ops (`account_list`, etc.) return `400` until QuickBooks is
   connected — expected, and now surfaced nicely via `get_started`.

---

## 7. Use it with Claude Desktop ("normal Claude")

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "savetrix": {
      "command": "node",
      "args": ["C:\\Expense-Management-web-app\\mcp-server\\dist\\index.js"],
      "env": {
        "SAVETRIX_WEB_URL": "https://scantrix.ai"
      }
    }
  }
}
```

Then in Claude Desktop:
1. Ask "get me started with Savetrix" → runs `savetrix_get_started`, shows the
   **scantrix.ai** sign-in link.
2. Log in via the `savetrix_login` tool (email + password).
3. Ask to "connect QuickBooks" → `savetrix_qb_connect` returns a clickable
   **Authorize QuickBooks** link; approve in the browser.
4. Confirm with `savetrix_qb_connections`, then work with invoices/vendors.

> MCP tools load at Claude startup. After rebuilding the server, restart Claude
> Desktop (or `/mcp` reconnect in Claude Code) so the new tools appear.

---

## 8. Key decisions

1. **File-based session** over a DB — simple, survives restarts, user-inspectable.
2. **Single `SavetrixClient`** — one place for auth headers + token refresh.
3. **Zod-validated inputs** — type-safe args, clear errors back to the assistant.
4. **Confirmation gates** on destructive tools — no accidental posts/deletes.
5. **Two transports** — stdio for Claude Desktop, HTTP for hosted/testing.
6. **Markdown link tools** (`get_started`, `qb_connect`) — one-click onboarding
   inside a normal Claude chat, no CLI gymnastics.
