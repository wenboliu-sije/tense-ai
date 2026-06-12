# Filesystem Overview

- Date: 2026/06/12
- Summary: `tense-ai` is a TypeScript npm workspace for a Monolis MCP proof of concept. The current package, `monolis-mcp`, turns a Monolis OpenAPI snapshot into MCP tools for the sales-order vertical slice, serves those tools over stdio for Claude Code, authenticates API calls with Monolis credentials, and keeps planned demo behavior documented under `docs/superpowers`.

## Structure

```
tense-ai/
├── .gitignore                                        — excludes installed modules, build output, and local secret files from version control
├── package-lock.json                                 — npm lockfile pinning the workspace dependency graph
├── package.json                                      — npm workspace root with the shared `test` script and development toolchain
├── tsconfig.base.json                                — shared strict TypeScript compiler settings for workspace packages
├── .git/                                             — local Git repository metadata and object database
├── docs/                                             — project planning and design documentation
│   └── superpowers/                                  — structured implementation artifacts produced by the Superpowers planning workflow
│       ├── plans/                                    — executable task plans for building the Monolis MCP proof of concept
│       │   └── 2026-06-12-monolis-mcp-poc.md         — step-by-step implementation plan for the MCP server and demo setup
│       └── specs/                                    — higher-level design notes and product/architecture decisions
│           └── 2026-06-11-monolis-mcp-poc-design.md  — design brief for exposing Monolis workflows to Claude Code through MCP
└── packages/                                         — npm workspace packages owned by this repository
    └── monolis-mcp/                                  — MCP server package that wraps Monolis API endpoints as Claude Code tools
        ├── package.json                              — package-local scripts and runtime dependencies for the MCP server
        ├── tsconfig.json                             — TypeScript project configuration for source, scripts, and tests
        ├── scripts/                                  — operational helpers for refreshing API metadata and demo configuration
        │   ├── emit-workspace-settings.ts            — generates Claude Code read-tool allowlist settings from the current manifest
        │   └── fetch-openapi.ts                      — downloads the Monolis backend OpenAPI document into `openapi.json`
        ├── src/                                      — runtime server, OpenAPI-to-tool generator, and Monolis client code
        │   ├── cluster.ts                            — defines the sales-order-related path prefixes included in the generated tool set
        │   ├── index.ts                              — stdio entrypoint that loads env, reads `openapi.json`, builds the manifest, and starts MCP
        │   ├── manifest.ts                           — shared TypeScript types for MCP tool definitions and JSON input schemas
        │   ├── monolis-client.ts                     — authenticated Monolis REST client with JWT login, retry-on-401, and response truncation
        │   ├── overrides.ts                          — handwritten tool exclusions, description overrides, and curated write-tool definitions
        │   ├── server.ts                             — MCP `Server` wiring for `tools/list` and `tools/call`
        │   └── generator/                            — transforms OpenAPI routes and parameters into MCP tool metadata
        │       ├── generate.ts                       — filters in-cluster GET routes and emits sorted, deduplicated read-tool definitions
        │       ├── naming.ts                         — converts HTTP routes and path params into stable snake_case MCP tool names
        │       └── schema.ts                         — builds MCP input JSON Schemas from OpenAPI path and query parameters
        └── test/                                     — Vitest coverage for generator behavior, client calls, overrides, and server wiring
            ├── cluster.test.ts                       — verifies sales-order cluster path inclusion and exclusion
            ├── generate.test.ts                      — checks OpenAPI route filtering, naming collisions, sorting, and generated descriptions
            ├── monolis-client.test.ts                — exercises login, request shaping, auth retry, and response truncation behavior
            ├── naming.test.ts                        — verifies route-to-tool-name normalization rules
            ├── overrides.test.ts                     — checks write-tool injection and override/exclusion behavior
            ├── schema.test.ts                        — verifies OpenAPI parameter schemas and `$ref` resolution
            ├── server.test.ts                        — tests MCP tool listing, call routing, unknown tools, and error responses
            └── fixtures/                             — reusable test data for generator and schema tests
                └── openapi.fixture.json              — compact OpenAPI sample covering in-cluster and out-of-cluster routes
```
