# Savetrix MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant
(Claude Desktop, Claude Code, or any MCP-capable client) operate the Savetrix /
ScanTrix invoice app on your behalf — reading data, and with explicit
confirmation, writing it: uploading and posting invoices to QuickBooks,
managing vendors, GL accounts, tax codes, team members, and your subscription.

## Prerequisites

- Node.js >= 20.6
- A Savetrix account (the server authenticates as you using the app's login)

## Install & build

```
cd mcp-server
npm install
npm run build
```

## Authenticate

The server acts as a Savetrix user. Configure one of:

1. Env vars in `mcp-server/.env` (copy `.env.example`):

   ```
   SAVETRIX_EMAIL=you@company.com
   SAVETRIX_PASSWORD=your-password
   ```

2. Or call the `savetrix_login` tool from your AI client and provide the
   email/password there. Tokens are stored in `.savetrix-mcp/config.json`
   (created in the working directory) with 0600 permissions.

3. Or set `SAVETRIX_ACCESS_TOKEN` / `SAVETRIX_REFRESH_TOKEN` to an existing
   session's tokens.

## Run for Claude Desktop / Claude Code (stdio)

```
node dist/index.js
```

Add to `claude_desktop_config.json` (see `claude_desktop_config.example.json`),
or in Claude Code:

```
claude mcp add savetrix -- node C:\path\to\mcp-server\dist\index.js
```

## Run as a remote server (streamable HTTP)

```
node dist/index.js --http --port 8000
```

Protect it with an API key:

```
SAVETRIX_MCP_API_KEY=some-long-random-secret
```

Every `/mcp` request must then send `Authorization: Bearer <key>`. Terminate
TLS at your load balancer / proxy. A single instance serves one Savetrix user;
run one instance per user for multi-tenant, or add MCP OAuth later.

## Available tools

All tools are prefixed `savetrix_` (e.g. `savetrix_invoice_list`,
`savetrix_invoice_post_to_qb`). Destructive tools — posting invoices, rejecting,
deactivating vendors, removing team members, disconnecting QuickBooks, changing
subscription, logout — require the caller to pass `confirm: true`; the server
rejects them otherwise.

See `docs/superpowers/specs/2026-07-31-savetrix-mcp-server-design.md` for the
full tool inventory and API contracts.

## Safety

- Nothing happens without your login — the server acts only as your account.
- Write actions are gated: destructive ones need an explicit `confirm: true`.
- Vendors are deactivated (restorable), not deleted.
- Every call uses the same secure Bearer-token + refresh flow as the web app.

## Development

```
npm run typecheck   # tsc --noEmit
npm run test        # node:test unit tests (no live API)
npm run build       # tsc emit -> dist/
npm run smoke       # MCP initialize + tools/list handshake against dist/
```

The verification gate is build + tests + smoke. Live end-to-end testing against
`api.savetrix.com` is a manual step.
