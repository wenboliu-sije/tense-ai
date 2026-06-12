# Dependency Overview

- Date: 2026/06/12
- Sources: `package.json`, `packages/monolis-mcp/package.json`

## List

### `package.json` - `devDependencies`

- `@types/node`: `^25.9.3`
    - Node.js type declarations used by the TypeScript compiler for built-in modules such as `fs`, `url`, and global `fetch`.
- `tsx`: `^4.22.4`
    - TypeScript execution runner used by package scripts to start the MCP server and run maintenance scripts without a build step.
- `typescript`: `^6.0.3`
    - Strict type checker for the workspace's ESM TypeScript source, scripts, and tests.
- `vitest`: `^4.1.8`
    - Test runner for generator, schema, client, override, and MCP server behavior.

### `packages/monolis-mcp/package.json` - `dependencies`

- `@modelcontextprotocol/sdk`: `^1.29.0`
    - MCP client/server SDK used to expose Monolis API tools over stdio and to test server behavior with in-memory transports.
- `dotenv`: `^17.4.2`
    - Loads `packages/monolis-mcp/.env` credentials and base URL for the MCP entrypoint and OpenAPI fetch script.

## Taxonomy

- MCP runtime: dependencies that implement the protocol-facing server and tests.
   - `@modelcontextprotocol/sdk`
- Configuration and credentials: dependencies that load local runtime environment for Monolis API access.
   - `dotenv`
- TypeScript toolchain: dependencies that execute and type-check the TypeScript workspace.
   - `@types/node`
   - `tsx`
   - `typescript`
- Testing: dependencies that run the repository's unit tests.
   - `vitest`
