# Monolis MCP PoC — Design

**Date:** 2026-06-11
**Status:** Draft, pending review
**Goal:** A proof-of-concept demo for the CEO/PM showing that an AI agent can automate Monolis workflows by composing the existing backend APIs — without pre-coding the workflows themselves.

## Context

Monolis is a garment-industry ERP/SCM web app (NestJS backend, ~153 modules). We want an AI agent whose value proposition is automating workflows users currently perform manually in the web app. The workflows users actually want are unknown (CEO rejected the PM's list as "too simple"; no concrete alternatives given), so the strategy is:

1. **PoC (this doc):** prove an agent can compose Monolis APIs into arbitrary workflows on request, safely.
2. **Production (later doc):** a separate TypeScript agent service (own ReAct loop, sessions, streaming API consumed by the Monolis web app), with chat logs serving as workflow discovery. Recurring requests crystallize into skills (saved prompts), and only flows that demand determinism/event triggers become graphs.

The PoC borrows **Claude Code as the agent harness** — its ReAct loop, permission prompts, and deferred-tool search come for free. The only code we write is an **MCP server** exposing Monolis APIs as tools. The MCP server (and its OpenAPI→tools generator) carries forward as the production agent service's tool layer; the harness is the throwaway part.

## Architecture

```
┌──────────────────┐  stdio (JSON-RPC)  ┌─────────────────────┐  HTTP + JWT  ┌──────────────────┐
│ Claude Code       │◄─────────────────►│ monolis-mcp server  │─────────────►│ Monolis backend   │
│ (agent harness)   │   spawned child   │ (tools = endpoints) │              │ (NestJS, legacy)  │
│ + workspace/      │                   │                     │              │ + SwaggerModule → │
│   CLAUDE.md       │                   │                     │              │   openapi.json    │
└──────────────────┘                    └─────────────────────┘              └──────────────────┘
```

- Claude Code spawns the MCP server as a child process (stdio transport; no ports, no deployment).
- The server logs into Monolis at startup (`POST /auth/login`, test account) and attaches the JWT to every API call, so the backend's own authority checks apply to everything the agent does.
- Demo runs from `workspace/`, whose `CLAUDE.md` carries a garment-domain glossary and workflow hints.

## Tool scope: broad reads, curated writes

**Curation is a writes problem, not a reads problem.** The sales-order cluster (first vertical slice per the PM) has ~234 endpoints across: `sales-order`, `sales-order-style-image`, `so-size`, `so-size-breakdown`, `so-assortment`, `so-outsourcing-in-out(-quantity)`, `sopo`, `style`, `style-plan`, `costing-breakdown(-recap/-version)`, `bom-fabric`, `bom-acc`, `bom-all`, `fabric-consumption`, `acc-consumption`, `fabric-PO-consumption`, `acc-po-consumption`, `purchase-order`, `shipment-plan`, `assort`.

- **Reads:** ALL GET endpoints in the cluster, generated from `openapi.json`. Breadth makes live demos survivable — off-script questions still get answered. Read tools are allowlisted in Claude Code so the demo flows without prompts.
- **Writes:** 2–3 hand-picked, hand-described mutations only: purchase-order create/draft (the anchor scenario's mutation) and comment creation (low-stakes second write). Write tools are NOT allowlisted — Claude Code's permission prompt is the approval gate, shown deliberately in the demo.

## Components

### 1. Backend change: none
Swagger is already wired — `setupSwagger` runs for non-prod (main.ts:21) and serves the OpenAPI document at `GET /docs-json`. A fetch script pulls `${MONOLIS_BASE_URL}/docs-json` and snapshots it into the repo as `packages/monolis-mcp/openapi.json` (committed, so generator tests and regeneration are deterministic). Auth is Bearer JWT; `POST /auth/login` with `{loginId, password}` returns `{token}`.

### 2. `packages/monolis-mcp/src/generator/`
Reads `openapi.json`, filters to GET endpoints whose tags/paths match the SO-cluster allowlist, and emits one MCP tool definition per endpoint:
- **name:** derived from the route (e.g. `GET /sales-order/:id` → `sales_order_get`), deduplicated and stable across regenerations.
- **input schema:** from path/query params and DTO schemas.
- **description:** from `@ApiOperation` summary, overridable (see overrides).
Output is data (a JSON/TS tool manifest), not generated source files, so regeneration is diff-able and idempotent.

### 3. `packages/monolis-mcp/src/overrides/`
A handwritten file keyed by tool name:
- description overrides where domain jargon needs explanation (DCD, BOM, sopo, assortment…),
- the write tools (full handwritten definitions + handlers),
- an exclude list for endpoints that confuse more than help.
Overrides win over generated values at server build time.

### 4. `packages/monolis-mcp/src/monolis-client.ts`
- On startup: `POST /auth/login` with credentials from env (`MONOLIS_BASE_URL`, `MONOLIS_LOGIN_ID`, `MONOLIS_PASSWORD`); hold JWT; re-login on 401.
- `monolisFetch(method, path, args)`: substitutes path params, maps remaining args to query/body, attaches JWT, returns JSON; truncates oversized list responses with a "narrow your filter" hint rather than flooding the model's context.

### 5. `packages/monolis-mcp/src/server.ts`
`@modelcontextprotocol/sdk` stdio server: merges generated manifest + overrides, registers each tool with a generic handler that delegates to `monolisFetch`. No AI, no state beyond the JWT.

### 6. `workspace/`
- `.mcp.json`: registers the server with Claude Code.
- `CLAUDE.md`: garment-domain glossary (entities and their relationships: sales order → styles → colorways/BOMs; POs raised against BOM shortfalls; production stages cutting→sewing→finishing→QC→shipment), naming conventions, and guidance on multi-step workflow composition.
- `.claude/settings.json`: allowlist for read tools.

## Demo script

Environment: `monolis_back_legacy` run locally via OrbStack against a local clone of the staging DB; login uses the staging test account (valid in the clone). Credentials and base URL (`http://localhost:<port>`) supplied via gitignored `.env`, never committed to the repo or pasted into chats. Because the DB is a disposable clone, write tools can be exercised end-to-end during rehearsal (re-clone to reset).

1. **Warm-up (read-only):** "Summarize sales order X — styles, size breakdowns, costing status, blockers."
2. **Anchor, at batch scale:** "Check all sales orders shipping in July for material shortages, draft POs for every shortfall, and summarize what you drafted and what needs human attention." Iteration + exceptions + a mutation paused at the approval prompt. The pause is presented as the safety story, not friction.
3. **Off-script:** invite a live request from the room. Breadth of read tools is the hedge.

**Framing for the CEO's "too simple":** the pitch is the capability, not the workflow — "we didn't code the shortage workflow; the agent composed it from the same APIs the web app uses, and it can compose any workflow in this domain on request."

## Decisions (and why)

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript | NestJS backend (shared DTOs/types); reference architecture (Claude Code) is TS; agent orchestration is I/O-bound plumbing where TS is first-class. |
| LLM client | None for PoC (Claude Code is the harness); Anthropic SDK for production | Zero abstraction tax; LangChain fights custom loops; PydanticAI/pydantic-graph/Burr are Python. |
| Harness | Claude Code + MCP (stdio) | Loop, permission prompts, deferred tools free; only the MCP server is real work; MCP layer is production-reusable. |
| Tool pattern | Deferred tools (ToolSearch) for APIs; budgeted single-tool listing for skills/graphs later | ~234 endpoints don't fit a listing; dozens of skills/graphs do. Mirrors Claude Code's verified internals. |
| Permissions | Reads auto-allow, writes ask (Claude Code prompt) + backend authority via user JWT | Two enforcement layers; gate lives at tool-execution level so chat/skills/graphs share it in production. |
| Repo | `tense-ai` monorepo, `packages/monolis-mcp` now, `packages/agent-service` in production phase | No migration later; PoC artifact is the production tool layer. |

## Out of scope (PoC)

- Own agent service, chat UI, streaming protocol, sessions (production phase).
- Skills and graph runtime (production phases 2–3).
- OpenAPI coverage beyond the SO cluster; write endpoints beyond PO-create/comment.
- Multi-user/auth handoff (single test account); event triggers; model selection; usage metering.

## Risks

- **Swagger output quality:** decorators exist but openapi.json may have gaps (missing response schemas are fine — tools need input schemas; missing input DTO annotations would hurt). Mitigation: generator falls back to permissive schemas + override file.
- **Domain jargon:** model may misuse endpoints whose names don't convey meaning. Mitigation: description overrides + CLAUDE.md glossary; rehearsal loop (step 5) exists precisely to catch these.
- **Demo data:** local staging-clone DB gives realistic data and safe writes; remaining check is whether the test account's authority covers the SO cluster including PO creation. Decide whether demo day runs against the local stack or real staging, and rehearse against that target at least once.
- **CEO expectations:** "too simple" may persist regardless. Mitigation: capability framing + live off-script request; afterwards, pilot chat logs become the empirical answer to "what workflows do users want."

## Success criteria

- Anchor scenario completes end-to-end against real backend data: shortage analysis across multiple sales orders → drafted POs behind an approval prompt → accurate summary.
- At least one unrehearsed read query answered correctly during rehearsal.
- Total new code confined to `packages/monolis-mcp` + workspace config; zero backend changes.
