# Research: Can Claude "sidecar-curl" a file to mcp.scantrix.ai outside of MCP tool-call arguments?

Context: ScanTrix/Savetrix runs a remote MCP server at `mcp.scantrix.ai`, added by
end-users as a custom connector in claude.ai (Settings → Connectors). End-users are
non-technical consumers chatting in claude.ai's normal web/desktop product — not
developers calling the Messages API, and not Claude Code. Two upload workarounds are
already built (`fileUrl` tool argument; ticketed browser-upload link). This note checks
a third proposed approach: have Claude `curl -F file=@... ` an invoice straight to
ScanTrix's REST endpoint from a sandbox with network access, then call an MCP tool with
the returned file ID.

Research scope: primary sources only — docs.anthropic.com / platform.claude.com,
support.anthropic.com / support.claude.com, anthropic.com/engineering, and the official
MCP spec (modelcontextprotocol.io/specification, and the
modelcontextprotocol/modelcontextprotocol GitHub repo). Docs.anthropic.com and
support.anthropic.com now 301-redirect to platform.claude.com and support.claude.com
respectively (Anthropic's rebrand of the developer/help sites) — same organization, same
content, new host, noted where relevant.

---

## Q1 — Does claude.ai give normal end-users a sandbox with outbound network access to arbitrary domains?

**Verdict: Partially yes, but not to arbitrary domains — No for the practical question.**

claude.ai *does* expose a code-execution sandbox to ordinary chat users. It does *not*
give that sandbox open network access to third-party domains like `mcp.scantrix.ai`.

- The current consumer-facing feature is called **"Code execution and file creation"**
  (the successor to the older "Analysis tool" branding — the old support article ID,
  `support.claude.com/en/articles/10008684-enabling-and-using-the-analysis-tool`, now
  returns HTTP 404, consistent with it having been retired/merged into the current
  article below).

- **Primary source:** [Create and edit files with Claude](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude) (Claude Help Center, dated April 29, 2026).
  > "Code execution and file creation is available to all Claude users (Free, Pro, Max,
  > Team, and Enterprise) on the web, Claude Desktop, and Claude Mobile."

  > "Free, Pro, and Max plans: Code execution and file creation is enabled by default.
  > Network access is enabled, allowing Claude to install packages from approved
  > sources"

  > "Approved network domains — When network access is enabled, Claude can access the
  > following approved domains: Anthropic Services (Explicit): api.anthropic.com,
  > statsig.anthropic.com; GitHub: github.com; NPM: registry.npmjs.org, npmjs.com,
  > npmjs.org; Python: pypi.org, files.pythonhosted.org, pythonhosted.org; Rust:
  > crates.io, index.crates.io, static.crates.io; Ubuntu: archive.ubuntu.com,
  > security.ubuntu.com; Yarn: yarnpkg.com, registry.yarnpkg.com"

  This is a fixed allowlist of package-registry/CDN domains. `mcp.scantrix.ai` is not on
  it, and a Free/Pro/Max end-user has no UI to add a domain to it.

  For Team/Enterprise plans, an **organization owner** can change the policy in
  Organization settings → Capabilities: "Allow network egress toggled off" (no internet
  at all), "...to package managers only" (default for Team), "...to package managers and
  specific domains" (custom whitelist an admin configures), or "All domains" ("Claude has
  full internet access except for domains on Anthropic's legal blocklist"). In principle
  a Team/Enterprise customer's admin *could* whitelist `mcp.scantrix.ai` or flip to "All
  domains" — but that is a deliberate, org-admin-only configuration step outside
  ScanTrix's control and not the default state a non-technical Free/Pro/Max end-user
  (the population in question) is in.

  The article also notes: *"If MCP (Model Context Protocol) integrations are enabled,
  network communication remains possible through those connections regardless of the
  network egress setting."* This refers to Claude's normal MCP tool-calling path (the
  JSON-RPC channel), not to the sandbox being able to `curl` MCP endpoints directly — it
  does not describe or enable a sidecar-HTTP path.

- **Anthropic engineering blog:** [How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude) (published May 25, 2026) confirms the architecture but is *silent on the specific network-egress policy* for claude.ai's container:
  > "When Claude runs code inside claude.ai, it does so in a gVisor container on isolated
  > infrastructure. The agent is entirely server-side; no code runs on the local machine,
  > and the filesystem is ephemeral (per-session)."

  Notably, this article *does* state explicit network policy for the other two products
  it covers (Claude Code: "network is denied by default" in the local OS-level sandbox;
  Claude Cowork: VM enforces an egress allowlist) but does not restate a network policy
  for claude.ai's own container in this piece — the definitive statement for claude.ai
  comes from the Help Center article above, not from this engineering post. **Flagging
  this as a minor gap/ambiguity**: the engineering blog and the help-center article are
  both primary, but only the help-center article states the actual egress rule for
  claude.ai.

- **Separately**, the Messages API's own **"Code execution tool"** (a distinct, developer-facing product — see Q3) is fully network-isolated, not merely allowlisted:
  [Code execution tool docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/code-execution-tool) (redirect target of `docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool`):
  > "Internet access: Completely disabled for security" / "External connections: No
  > outbound network requests permitted"

  Its "Platform availability" section lists only "Claude API (Anthropic)," "Claude
  Platform on AWS," and "Microsoft Foundry" — **claude.ai is not listed**, confirming
  this is a separate surface from the consumer feature described above.

**Bottom line for Q1:** the sandbox real end-users get in claude.ai has network access,
but only to a short list of package-registry domains (plus Anthropic's own API host).
It cannot reach `mcp.scantrix.ai` by default, and nothing in Anthropic's own docs
describes a path for an end-user or for ScanTrix to add it to that allowlist.

---

## Q2 — Can a chat-attached file be passed into a remote MCP tool call without the model re-generating its bytes as base64 output?

**Verdict: No — confirmed absent from the spec, including its current (2026-07-28) revision.**

MCP resources are documented as flowing **server → client**, never the reverse:

- **Primary source:** [MCP specification 2026-07-28 — Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources):
  > "The Model Context Protocol (MCP) provides a standardized way for **servers to
  > expose resources to clients**. Resources allow servers to share data that provides
  > context to language models..."

  The only resource-content types defined are `text` and binary/`blob` (base64), and the
  only protocol messages are `resources/list` and `resources/read` — both client-initiated
  *reads* of server-held content; there is no `resources/write` or client-to-server
  upload verb.

- **Primary source:** [MCP specification 2026-07-28 — Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): a `tools/call` request's `arguments` is just a plain JSON object validated against the tool's `inputSchema` — no blob/binary/resource-reference type is defined for tool-call *inputs*. The blob-capable content types (`image`, `audio`, `resource_link`, embedded `resource`) are documented exclusively as part of **Tool Result** content (i.e., what the *server returns*, not what the client/model sends in). This directly confirms the directionality gap: MCP's binary-content machinery exists for server→client output, not client→server input.

- **Primary source (spec repo, GitHub):** [modelcontextprotocol/modelcontextprotocol discussion #1197](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1197) — Anthropic maintainer `jerome3o-anthropic`:
  > "I don't think you're overlooking anything, your use-case is currently finicky in the
  > current state of the protocol."

  A later (July 2026) comment in the same discussion:
  > "the published MCP `2025-11-25` protocol still has no interoperable **client → server
  > file-upload primitive**."

  > "`roots/list` returns `file://` URIs that describe filesystem scope; it does not
  > transfer bytes or make a remote server able to read the client's disk."

  > "There is active standards work for a portable version of this: SEP-2631 proposes
  > file objects plus `files/authorizeUpload` / `files/authorizeDownload`, keeping bytes
  > out of JSON-RPC... It is still an open Draft, so feature-detect it and retain the
  > handle/upload fallback rather than treating it as published MCP behavior."

  I independently checked the **[2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)** (the current spec revision as of this research, superseding 2025-11-25) — it contains no mention of SEP-2631, file objects, or any file-upload primitive, consistent with that proposal still being an unmerged Draft.

- **Anthropic's own product docs add nothing on the reverse path either.** claude.ai's custom-connector help article, [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), states only:
  > "When you add a custom connector, Claude connects to your remote MCP server from
  > Anthropic's cloud infrastructure, rather than from your local device."

  It says nothing about attached-file-to-tool-call bridging. Likewise, the Messages
  API's [MCP connector docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) expose SDK helpers (`mcp_resource_to_content`, `mcp_resource_to_file`) that only convert a resource *already read from* an MCP server into message content or an upload — again the server→client direction, never client-attached-file→tool-call-input.

**Bottom line for Q2:** there is no primary-source evidence of this mechanism anywhere —
not in the current MCP spec, not in the spec's own GitHub discussion (where Anthropic's
maintainer explicitly confirms the gap), and not in any Anthropic product doc. This is a
confirmed absence, not merely an unresearched one.

---

## Q3 — Is the Messages-API bash/code-execution tool the same thing an end-user gets inside claude.ai, or a separate developer-only capability?

**Verdict: Confirmed separate.** The bash tool and the Messages-API code execution tool
are developer-wired capabilities; a ScanTrix end-user using claude.ai's normal product
never gets them, regardless of what Claude "decides" to attempt.

- **Primary source:** [Bash tool docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/bash-tool) (redirect target of `docs.anthropic.com/.../bash-tool`):
  > "The bash tool is a [client tool]: Claude doesn't run commands itself. When you
  > include the tool in a request, Claude replies with a `tool_use` block that names the
  > command to run. **Your application runs that command in a bash session it owns** and
  > returns the output in a `tool_result` block."

  This is unambiguous: the bash tool requires the *developer's own application* to
  execute commands and return results. There is no "application" behind a plain claude.ai
  chat session in the sense this doc means — claude.ai does not expose this tool to its
  own chat users at all; it is purely a Messages-API primitive for third-party builders.

- **Primary source:** [Code execution tool docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/code-execution-tool), "Platform availability" section:
  > "Code execution is available on: Claude API (Anthropic); Claude Platform on AWS;
  > Microsoft Foundry ... Code execution is not currently available on Amazon Bedrock or
  > Google Cloud."

  claude.ai is not in this list. This tool is billed to the API caller by execution time
  (or token cost) per the same doc's Usage/Pricing section — i.e., billed to the
  *developer's* API key, not bundled into a claude.ai subscription.

- **Network policy also differs**, reinforcing that these are not the same
  implementation reused unchanged: the Messages-API code execution container is fully
  network-isolated ("Internet access: Completely disabled for security" — see Q1),
  whereas claude.ai's own "Code execution and file creation" feature has network access
  *enabled by default* (to an allowlist) for Free/Pro/Max users, per
  [Create and edit files with Claude](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude). If claude.ai's consumer sandbox and the API's `code_execution` tool were literally the same deployed policy, these two primary sources would agree; they don't.

**Discrepancy worth flagging explicitly:** Anthropic's own engineering blog
([How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude)) describes claude.ai's sandbox in terms ("gVisor container," "isolated infrastructure") that overlap with how the API docs describe the `code_execution` container, without ever stating outright whether they're the same underlying service with different policy knobs or genuinely separate systems. Anthropic does not appear to publish a single page that directly compares the two — this had to be pieced together from the API docs' "Platform availability" list (which omits claude.ai) plus the differing network defaults. Treat "these are architecturally related but separately configured/documented products" as the best-supported reading, not "confirmed identical infrastructure."

**Bottom line for Q3:** confirmed — the bash tool and the Messages-API code execution
tool are developer-side, application-provided or API-billed capabilities. claude.ai's
own consumer sandbox is a different, separately documented feature with its own (more
permissive but still allowlisted) network policy. A ScanTrix end-user on claude.ai's
normal chat product has no path to the raw Messages-API bash tool under any
circumstance.

---

## Practical summary

ScanTrix's non-technical claude.ai end-users cannot rely on Claude "sidecar-curling" an
invoice file straight to `mcp.scantrix.ai`'s REST endpoint outside of MCP tool-call
arguments. The bash tool and the Messages API's fully network-isolated code-execution
tool are developer-only primitives that never appear inside a normal claude.ai chat
session. claude.ai does give ordinary chat users its own separate code-execution sandbox
("Code execution and file creation," formerly "Analysis tool"), and that sandbox does
have outbound network access by default — but only to a fixed allowlist of package-registry
domains (npm, PyPI, GitHub, crates.io, Ubuntu archives, Yarn) plus Anthropic's own API
host, not to arbitrary third-party endpoints; `mcp.scantrix.ai` is not reachable from it,
and nothing in Anthropic's docs gives an end-user or ScanTrix a way to add it. Separately,
and independent of network policy, the MCP specification itself — confirmed directly by
an Anthropic maintainer in the spec's own GitHub repo, and unchanged in the current
2026-07-28 revision — has no client-to-server file-upload primitive at all: resources and
blob/binary content flow server-to-client only, so even if the sandbox could reach
ScanTrix's endpoint, there is still no standard way to get a chat-attached file into an
MCP tool call except by having the model re-emit it as base64 (impractical for multi-MB
scans) or by using the two workarounds already built (`fileUrl` argument; ticketed
browser-upload link). The third approach is not a real option for this audience today.
