# Monolis MCP PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MCP server exposing the Monolis sales-order-cluster APIs as tools, plugged into Claude Code, demonstrating agent-composed ERP workflows (shortage analysis → draft POs behind approval).

**Architecture:** Claude Code (agent harness) spawns `monolis-mcp` over stdio. The server's read tools are generated from the backend's OpenAPI doc (`GET /docs-json`, snapshotted into the repo); two write tools are handwritten. Every call hits the Monolis REST API with a test user's JWT (`POST /auth/login` → `{token}` → `Authorization: Bearer`). The backend is `monolis_back_legacy` run locally via OrbStack against a local clone of the staging DB — realistic data, and writes are safe to exercise (re-clone the DB to reset).

**Tech Stack:** Node 24, npm workspaces, TypeScript (ESM, run via `tsx`), `@modelcontextprotocol/sdk` (low-level `Server` API — JSON Schemas pass through untouched, no zod conversion), `vitest`, `dotenv`.

**Spec:** `docs/superpowers/specs/2026-06-11-monolis-mcp-poc-design.md`

**Context for the engineer:**
- An MCP server is a function registry speaking JSON-RPC over stdin/stdout. It answers two requests: `tools/list` (tool names + descriptions + input JSON Schemas) and `tools/call` (run a tool, return text content). No AI inside.
- **stdout is the protocol channel.** Never `console.log` in server code — use `console.error`.
- The backend (`/Users/green/developer/work/monolis_back_legacy`) is NOT modified by this plan. It already serves OpenAPI JSON at `/docs-json` in non-prod.
- Secrets live in `packages/monolis-mcp/.env` (gitignored, user-provided): `MONOLIS_BASE_URL`, `MONOLIS_LOGIN_ID`, `MONOLIS_PASSWORD`. Tasks 1–8 need no network/credentials; Tasks 9–11 do.

**Repo layout after this plan:**

```
tense-ai/
├── package.json                      # npm workspace root
├── tsconfig.base.json
├── docs/superpowers/{specs,plans}/
├── packages/monolis-mcp/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                          # gitignored; user creates
│   ├── openapi.json                  # staging snapshot (Task 9)
│   ├── src/
│   │   ├── manifest.ts               # ToolDef types
│   │   ├── cluster.ts                # SO-cluster path filter
│   │   ├── generator/naming.ts       # route → tool name
│   │   ├── generator/schema.ts       # OpenAPI params → input JSON Schema
│   │   ├── generator/generate.ts     # openapi doc → ToolDef[]
│   │   ├── overrides.ts              # descriptions, excludes, write tools
│   │   ├── monolis-client.ts         # login + authenticated fetch
│   │   ├── server.ts                 # MCP Server wiring
│   │   └── index.ts                  # stdio entrypoint
│   ├── scripts/fetch-openapi.ts
│   ├── scripts/emit-workspace-settings.ts
│   └── test/
│       ├── fixtures/openapi.fixture.json
│       └── *.test.ts
└── workspace/                        # demo dir — open Claude Code here
    ├── .mcp.json
    ├── CLAUDE.md
    └── .claude/settings.json         # generated read-tool allowlist
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/monolis-mcp/package.json`, `packages/monolis-mcp/tsconfig.json`

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "tense-ai",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": { "test": "vitest run" },
  "devDependencies": {}
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.local
```

- [ ] **Step 2: Package files**

`packages/monolis-mcp/package.json`:
```json
{
  "name": "monolis-mcp",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "fetch-openapi": "tsx scripts/fetch-openapi.ts",
    "emit-settings": "tsx scripts/emit-workspace-settings.ts"
  }
}
```

`packages/monolis-mcp/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "scripts", "test"] }
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/green/developer/personal/tense-ai
npm install -D typescript tsx vitest @types/node
npm install @modelcontextprotocol/sdk dotenv -w monolis-mcp
```
Expected: lockfile created, no errors. Verify: `npx tsc --version` and `npx vitest --version` print versions.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold npm workspace with monolis-mcp package"
```

---

### Task 2: ToolDef types + SO-cluster filter

**Files:**
- Create: `packages/monolis-mcp/src/manifest.ts`, `packages/monolis-mcp/src/cluster.ts`
- Test: `packages/monolis-mcp/test/cluster.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cluster.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isInCluster } from '../src/cluster.js';

describe('isInCluster', () => {
  it('accepts SO-cluster routes', () => {
    expect(isInCluster('/sales-order')).toBe(true);
    expect(isInCluster('/sales-order/{id}')).toBe(true);
    expect(isInCluster('/style-plan')).toBe(true);
    expect(isInCluster('/fabric-PO-consumption/{id}')).toBe(true);
  });
  it('rejects everything else, including prefix lookalikes', () => {
    expect(isInCluster('/user')).toBe(false);
    expect(isInCluster('/auth/login')).toBe(false);
    expect(isInCluster('/styles')).toBe(false); // 'style' must match exactly, not as prefix
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cluster.test.ts` (from `packages/monolis-mcp`)
Expected: FAIL — cannot resolve `../src/cluster.js`

- [ ] **Step 3: Implement**

`src/manifest.ts`:
```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface InputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  method: HttpMethod;
  path: string; // OpenAPI style, e.g. '/sales-order/{id}'
  readonly: boolean;
  inputSchema: InputSchema;
}
```

`src/cluster.ts`:
```ts
// First path segments of the sales-order vertical slice (per spec).
export const SO_CLUSTER_SEGMENTS = new Set([
  'sales-order',
  'sales-order-style-image',
  'so-size',
  'so-size-breakdown',
  'so-assortment',
  'so-outsourcing-in-out',
  'so-outsourcing-in-out-quantity',
  'sopo',
  'style',
  'style-plan',
  'costing-breakdown',
  'costing-breakdown-recap',
  'costing-breakdown-version',
  'bom-fabric',
  'bom-acc',
  'bom-all',
  'fabric-consumption',
  'acc-consumption',
  'fabric-PO-consumption',
  'acc-po-consumption',
  'purchase-order',
  'shipment-plan',
  'assort',
]);

export function isInCluster(path: string): boolean {
  const first = path.replace(/^\//, '').split('/')[0];
  return SO_CLUSTER_SEGMENTS.has(first);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cluster.test.ts` — Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ToolDef types and SO-cluster route filter"
```

---

### Task 3: Tool naming from routes

**Files:**
- Create: `packages/monolis-mcp/src/generator/naming.ts`
- Test: `packages/monolis-mcp/test/naming.test.ts`

- [ ] **Step 1: Write the failing test**

`test/naming.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toolNameFromRoute } from '../src/generator/naming.js';

describe('toolNameFromRoute', () => {
  it('joins method + segments with underscores', () => {
    expect(toolNameFromRoute('GET', '/sales-order')).toBe('get_sales_order');
  });
  it('turns path params into by_<param>', () => {
    expect(toolNameFromRoute('GET', '/sales-order/{id}')).toBe('get_sales_order_by_id');
  });
  it('snake_cases camelCase params and lowercases everything', () => {
    expect(toolNameFromRoute('GET', '/fabric-PO-consumption/{styleId}/detail')).toBe(
      'get_fabric_po_consumption_by_style_id_detail',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/naming.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`src/generator/naming.ts`:
```ts
const camelToSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

export function toolNameFromRoute(method: string, path: string): string {
  const segments = path
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map(seg => (seg.startsWith('{') ? `by_${camelToSnake(seg.slice(1, -1))}` : seg));
  return [method, ...segments]
    .join('_')
    .replace(/-/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/naming.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: deterministic tool names from method + route"
```

---

### Task 4: Input schema from OpenAPI parameters

**Files:**
- Create: `packages/monolis-mcp/src/generator/schema.ts`, `packages/monolis-mcp/test/fixtures/openapi.fixture.json`
- Test: `packages/monolis-mcp/test/schema.test.ts`

- [ ] **Step 1: Create the shared fixture**

`test/fixtures/openapi.fixture.json` (handcrafted mini OpenAPI doc reused by Tasks 4–5):
```json
{
  "openapi": "3.0.0",
  "info": { "title": "fixture", "version": "1.0.0" },
  "components": {
    "schemas": {
      "StatusEnum": { "type": "string", "enum": ["OPEN", "CLOSED"] }
    }
  },
  "paths": {
    "/sales-order": {
      "get": {
        "summary": "List sales orders",
        "parameters": [
          { "name": "buyerId", "in": "query", "required": false, "schema": { "type": "number" }, "description": "Filter by buyer" },
          { "name": "status", "in": "query", "required": true, "schema": { "$ref": "#/components/schemas/StatusEnum" } }
        ]
      },
      "post": { "summary": "Create sales order" }
    },
    "/sales-order/{id}": {
      "get": {
        "summary": "Get one sales order",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "number" } }
        ]
      },
      "delete": { "summary": "Delete sales order" }
    },
    "/style-plan": {
      "get": { "summary": "List style plans" }
    },
    "/user": {
      "get": { "summary": "List users" }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildInputSchema } from '../src/generator/schema.js';
import fixture from './fixtures/openapi.fixture.json';

describe('buildInputSchema', () => {
  it('maps query and path params to properties; path params and required queries are required', () => {
    const op = fixture.paths['/sales-order'].get;
    const schema = buildInputSchema(op, fixture);
    expect(schema.properties.buyerId).toEqual({ type: 'number', description: 'Filter by buyer' });
    expect(schema.required).toEqual(['status']);
  });
  it('resolves $ref against components', () => {
    const op = fixture.paths['/sales-order'].get;
    const schema = buildInputSchema(op, fixture);
    expect(schema.properties.status).toMatchObject({ type: 'string', enum: ['OPEN', 'CLOSED'] });
  });
  it('requires path params', () => {
    const op = fixture.paths['/sales-order/{id}'].get;
    expect(buildInputSchema(op, fixture).required).toEqual(['id']);
  });
  it('handles operations with no parameters', () => {
    const op = fixture.paths['/style-plan'].get;
    expect(buildInputSchema(op, fixture)).toEqual({ type: 'object', properties: {} });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/schema.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 4: Implement**

`src/generator/schema.ts`:
```ts
import type { InputSchema } from '../manifest.js';

interface OpenAPIParam {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: unknown;
}

// Resolves a single top-level '#/...' $ref against the document. Nested refs
// inside resolved schemas are left as-is — good enough for query/path params.
export function resolveRef(schema: unknown, doc: unknown): unknown {
  if (schema && typeof schema === 'object' && '$ref' in (schema as Record<string, unknown>)) {
    const ref = (schema as { $ref: string }).$ref;
    let node: unknown = doc;
    for (const part of ref.replace(/^#\//, '').split('/')) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return node ?? { type: 'string' };
  }
  return schema;
}

export function buildInputSchema(operation: unknown, doc: unknown): InputSchema {
  const params = ((operation as { parameters?: OpenAPIParam[] }).parameters ?? []).filter(
    p => p.in === 'path' || p.in === 'query',
  );
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    const resolved = (resolveRef(p.schema, doc) as Record<string, unknown>) ?? { type: 'string' };
    properties[p.name] = p.description ? { ...resolved, description: p.description } : resolved;
    if (p.in === 'path' || p.required) required.push(p.name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/schema.test.ts` — Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: build tool input schemas from OpenAPI parameters"
```

---

### Task 5: Manifest generator

**Files:**
- Create: `packages/monolis-mcp/src/generator/generate.ts`
- Test: `packages/monolis-mcp/test/generate.test.ts`

- [ ] **Step 1: Write the failing test**

`test/generate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateManifest } from '../src/generator/generate.js';
import fixture from './fixtures/openapi.fixture.json';

describe('generateManifest', () => {
  const manifest = generateManifest(fixture);

  it('emits one read tool per in-cluster GET, sorted by name', () => {
    expect(manifest.map(t => t.name)).toEqual([
      'get_sales_order',
      'get_sales_order_by_id',
      'get_style_plan',
    ]);
  });
  it('skips non-GET methods and out-of-cluster paths', () => {
    expect(manifest.find(t => t.method !== 'GET')).toBeUndefined();
    expect(manifest.find(t => t.path === '/user')).toBeUndefined();
  });
  it('marks tools readonly with summary as description', () => {
    const t = manifest.find(t => t.name === 'get_sales_order')!;
    expect(t.readonly).toBe(true);
    expect(t.description).toBe('List sales orders');
    expect(t.inputSchema.properties).toHaveProperty('buyerId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/generate.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`src/generator/generate.ts`:
```ts
import { isInCluster } from '../cluster.js';
import type { ToolDef } from '../manifest.js';
import { toolNameFromRoute } from './naming.js';
import { buildInputSchema } from './schema.js';

interface OpenAPIDoc {
  paths?: Record<string, Record<string, unknown>>;
}

export function generateManifest(doc: unknown): ToolDef[] {
  const tools: ToolDef[] = [];
  const used = new Set<string>();
  for (const [path, ops] of Object.entries((doc as OpenAPIDoc).paths ?? {})) {
    if (!isInCluster(path)) continue;
    const op = ops['get'] as { summary?: string; description?: string } | undefined;
    if (!op) continue;
    const base = toolNameFromRoute('GET', path);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    tools.push({
      name,
      description: op.summary || op.description || `GET ${path}`,
      method: 'GET',
      path,
      readonly: true,
      inputSchema: buildInputSchema(op, doc),
    });
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/generate.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: generate read-tool manifest from OpenAPI doc"
```

---

### Task 6: Overrides (descriptions, excludes, handwritten write tools)

**Files:**
- Create: `packages/monolis-mcp/src/overrides.ts`
- Test: `packages/monolis-mcp/test/overrides.test.ts`

The two write tools mirror real backend DTOs (verified in `monolis_back_legacy`): `PostPurchaseOrderBody` (`src/module/purchase-order/dto/request/post-purchase-order.req.ts`) and `CreateCommentBody` (`src/module/comment/type.ts`).

- [ ] **Step 1: Write the failing test**

`test/overrides.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../src/manifest.js';
import { applyOverrides } from '../src/overrides.js';

const fake = (name: string): ToolDef => ({
  name,
  description: 'generated',
  method: 'GET',
  path: `/${name}`,
  readonly: true,
  inputSchema: { type: 'object', properties: {} },
});

describe('applyOverrides', () => {
  it('appends the handwritten write tools, marked non-readonly', () => {
    const out = applyOverrides([fake('get_sales_order')]);
    const writes = out.filter(t => !t.readonly).map(t => t.name);
    expect(writes).toEqual(['create_purchase_order', 'create_comment']);
  });
  it('write tool schemas match the backend DTOs', () => {
    const po = applyOverrides([]).find(t => t.name === 'create_purchase_order')!;
    expect(po.method).toBe('POST');
    expect(po.path).toBe('/purchase-order');
    expect(po.inputSchema.required).toEqual([
      'purchaseOrderNo', 'type', 'brandId', 'supplierId', 'consumptionIds',
    ]);
    expect((po.inputSchema.properties.type as { enum: string[] }).enum).toContain('FABRIC');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/overrides.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`src/overrides.ts`:
```ts
import type { ToolDef } from './manifest.js';

// Tools that confuse more than help. Populated during rehearsal (Task 11).
export const excludedTools: string[] = [];

// Better descriptions for tools whose generated summary is missing or opaque.
// Populated during rehearsal (Task 11) as the model fumbles tools.
export const descriptionOverrides: Record<string, string> = {};

export const writeTools: ToolDef[] = [
  {
    name: 'create_purchase_order',
    description:
      'Create a draft purchase order (PO) for a supplier. A PO is created FROM material consumption records: ' +
      'gather consumption IDs via fabric-consumption / acc-consumption read tools, then pass them as consumptionIds. ' +
      'One PO targets one supplier and one material type.',
    method: 'POST',
    path: '/purchase-order',
    readonly: false,
    inputSchema: {
      type: 'object',
      properties: {
        purchaseOrderNo: {
          type: 'string',
          description: 'PO code, letters/digits/dashes, e.g. VUORI-CC-FA-25-1234567890. Must not contain * ? : \\ / [ ] < > "',
        },
        type: {
          type: 'string',
          enum: ['FABRIC', 'ACCESSORY', 'OUTSOURCING', 'PRE_OUTSOURCING'],
          description: 'What kind of material/service this PO purchases',
        },
        year: { type: 'string', description: 'Year, e.g. "2025"' },
        season: { type: 'string', description: 'Season code, e.g. "SS27"' },
        brandId: { type: 'number', description: 'Brand the PO belongs to' },
        supplierId: { type: 'number', description: 'Supplier receiving the PO' },
        consumptionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of the consumption records this PO fulfills (must be unique)',
        },
      },
      required: ['purchaseOrderNo', 'type', 'brandId', 'supplierId', 'consumptionIds'],
    },
  },
  {
    name: 'create_comment',
    description: 'Post a comment on a style (visible to the team in the Monolis web app).',
    method: 'POST',
    path: '/comment',
    readonly: false,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Comment text' },
        styleId: { type: 'number', description: 'Style to comment on' },
        images: { type: 'array', items: { type: 'string' }, description: 'Image URLs; pass [] if none' },
      },
      required: ['content', 'styleId', 'images'],
    },
  },
];

export function applyOverrides(generated: ToolDef[]): ToolDef[] {
  const kept = generated
    .filter(t => !excludedTools.includes(t.name))
    .map(t => (descriptionOverrides[t.name] ? { ...t, description: descriptionOverrides[t.name] } : t));
  return [...kept, ...writeTools];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/overrides.test.ts` — Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: overrides with handwritten PO/comment write tools"
```

---

### Task 7: Monolis HTTP client (login, bearer auth, 401 retry, truncation)

**Files:**
- Create: `packages/monolis-mcp/src/monolis-client.ts`
- Test: `packages/monolis-mcp/test/monolis-client.test.ts`

- [ ] **Step 1: Write the failing test**

`test/monolis-client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { MAX_RESULT_CHARS, MonolisClient } from '../src/monolis-client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const makeClient = (fetchImpl: typeof fetch) =>
  new MonolisClient({ baseUrl: 'https://staging.test', loginId: 'tester', password: 'pw', fetchImpl });

describe('MonolisClient', () => {
  it('logs in lazily and sends the bearer token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 'jwt-1' })) // login
      .mockResolvedValueOnce(json([{ id: 1 }]));       // api call
    const client = makeClient(fetchImpl);
    const result = await client.call({ method: 'GET', path: '/sales-order' }, {});
    expect(result).toBe('[{"id":1}]');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.test/auth/login');
    const init = fetchImpl.mock.calls[1][1];
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
  });

  it('substitutes path params and maps the rest to query (arrays appended per element)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({}));
    await makeClient(fetchImpl).call(
      { method: 'GET', path: '/sales-order/{id}' },
      { id: 7, status: 'OPEN', tags: ['a', 'b'] },
    );
    const url = fetchImpl.mock.calls[1][0] as string;
    expect(url).toBe('https://staging.test/sales-order/7?status=OPEN&tags=a&tags=b');
  });

  it('sends non-GET args as JSON body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({ id: 99 }));
    await makeClient(fetchImpl).call({ method: 'POST', path: '/comment' }, { content: 'hi', styleId: 3 });
    const init = fetchImpl.mock.calls[1][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ content: 'hi', styleId: 3 });
  });

  it('re-logs-in once on 401 and retries', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(json({ ok: true }));
    const result = await makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {});
    expect(result).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws on non-OK responses with status and body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {})).rejects.toThrow(
      'GET /style failed: 500 boom',
    );
  });

  it('truncates oversized responses with a hint', async () => {
    const big = 'x'.repeat(MAX_RESULT_CHARS + 100);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(new Response(big, { status: 200 }));
    const result = await makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {});
    expect(result.length).toBeLessThan(big.length);
    expect(result).toContain('truncated');
    expect(result).toContain('narrow');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/monolis-client.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`src/monolis-client.ts`:
```ts
import type { HttpMethod } from './manifest.js';

export const MAX_RESULT_CHARS = 40_000;

export interface MonolisClientConfig {
  baseUrl: string;
  loginId: string;
  password: string;
  fetchImpl?: typeof fetch;
}

interface CallTarget {
  method: HttpMethod;
  path: string;
}

export class MonolisClient {
  private token: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: MonolisClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async login(): Promise<void> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: this.cfg.loginId, password: this.cfg.password }),
    });
    if (!res.ok) throw new Error(`Monolis login failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('Monolis login response contained no token');
    this.token = data.token;
  }

  async call(target: CallTarget, args: Record<string, unknown>): Promise<string> {
    if (!this.token) await this.login();
    let res = await this.request(target, args);
    if (res.status === 401) {
      await this.login();
      res = await this.request(target, args);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${target.method} ${target.path} failed: ${res.status} ${text.slice(0, 2000)}`);
    }
    if (text.length > MAX_RESULT_CHARS) {
      const omitted = text.length - MAX_RESULT_CHARS;
      return `${text.slice(0, MAX_RESULT_CHARS)}\n...[truncated ${omitted} chars — narrow your query filters to see the rest]`;
    }
    return text;
  }

  private async request(target: CallTarget, args: Record<string, unknown>): Promise<Response> {
    const remaining = { ...args };
    const path = target.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = remaining[name];
      delete remaining[name];
      if (value === undefined) throw new Error(`Missing required path parameter: ${name}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(this.cfg.baseUrl + path);
    const init: RequestInit = {
      method: target.method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
    };
    if (target.method === 'GET') {
      for (const [key, value] of Object.entries(remaining)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) value.forEach(v => url.searchParams.append(key, String(v)));
        else url.searchParams.append(key, String(value));
      }
    } else {
      init.body = JSON.stringify(remaining);
    }
    return this.fetchImpl(url.toString(), init);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/monolis-client.test.ts` — Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Monolis client with login, 401 retry, and truncation"
```

---

### Task 8: MCP server + stdio entrypoint

**Files:**
- Create: `packages/monolis-mcp/src/server.ts`, `packages/monolis-mcp/src/index.ts`
- Test: `packages/monolis-mcp/test/server.test.ts`

- [ ] **Step 1: Write the failing test**

`test/server.test.ts` (uses the SDK's in-memory transport — a real MCP client talking to our server, no processes):
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDef } from '../src/manifest.js';
import { createServer } from '../src/server.js';

const manifest: ToolDef[] = [
  {
    name: 'get_sales_order',
    description: 'List sales orders',
    method: 'GET',
    path: '/sales-order',
    readonly: true,
    inputSchema: { type: 'object', properties: { buyerId: { type: 'number' } } },
  },
];

async function connect(call: (t: unknown, a: unknown) => Promise<string>) {
  const server = createServer(manifest, { call } as never);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('createServer', () => {
  it('lists manifest tools with schemas', async () => {
    const client = await connect(vi.fn());
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('get_sales_order');
    expect(tools[0].inputSchema.properties).toHaveProperty('buyerId');
  });

  it('routes tool calls to the Monolis client', async () => {
    const call = vi.fn().mockResolvedValue('[{"id":1}]');
    const client = await connect(call);
    const result = await client.callTool({ name: 'get_sales_order', arguments: { buyerId: 5 } });
    expect(result.content).toEqual([{ type: 'text', text: '[{"id":1}]' }]);
    expect(call).toHaveBeenCalledWith(manifest[0], { buyerId: 5 });
  });

  it('returns isError for unknown tools and client failures', async () => {
    const call = vi.fn().mockRejectedValue(new Error('GET /sales-order failed: 500'));
    const client = await connect(call);
    const unknown = await client.callTool({ name: 'nope', arguments: {} });
    expect(unknown.isError).toBe(true);
    const failed = await client.callTool({ name: 'get_sales_order', arguments: {} });
    expect(failed.isError).toBe(true);
    expect((failed.content as Array<{ text: string }>)[0].text).toContain('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement the server factory**

`src/server.ts`:
```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDef } from './manifest.js';
import type { MonolisClient } from './monolis-client.js';

export function createServer(manifest: ToolDef[], client: Pick<MonolisClient, 'call'>): Server {
  const server = new Server({ name: 'monolis', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: manifest.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const def = manifest.find(t => t.name === request.params.name);
    if (!def) {
      return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    }
    try {
      const text = await client.call(def, (request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5: Write the entrypoint** (no unit test — exercised by the Task 10 smoke test)

`src/index.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { generateManifest } from './generator/generate.js';
import { MonolisClient } from './monolis-client.js';
import { applyOverrides } from './overrides.js';
import { createServer } from './server.js';

// .env sits next to package.json regardless of the spawning process's cwd.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const required = ['MONOLIS_BASE_URL', 'MONOLIS_LOGIN_ID', 'MONOLIS_PASSWORD'] as const;
const missing = required.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`monolis-mcp: missing env vars: ${missing.join(', ')} (expected in packages/monolis-mcp/.env)`);
  process.exit(1);
}

const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
const doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
const manifest = applyOverrides(generateManifest(doc));

const client = new MonolisClient({
  baseUrl: process.env.MONOLIS_BASE_URL!,
  loginId: process.env.MONOLIS_LOGIN_ID!,
  password: process.env.MONOLIS_PASSWORD!,
});

const server = createServer(manifest, client);
await server.connect(new StdioServerTransport());
// stdout is the MCP protocol channel — log to stderr only.
console.error(`monolis-mcp: serving ${manifest.length} tools`);
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run` (from `packages/monolis-mcp`) — Expected: PASS, 5 test files

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: MCP server factory and stdio entrypoint"
```

---

### Task 9: Scripts (fetch OpenAPI snapshot, emit workspace allowlist)

**Files:**
- Create: `packages/monolis-mcp/scripts/fetch-openapi.ts`, `packages/monolis-mcp/scripts/emit-workspace-settings.ts`

Thin IO wrappers around already-tested functions — no unit tests; verified by running them in Task 10.

- [ ] **Step 1: Write the fetch script**

`scripts/fetch-openapi.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const base = process.env.MONOLIS_BASE_URL;
if (!base) {
  console.error('Set MONOLIS_BASE_URL in packages/monolis-mcp/.env first');
  process.exit(1);
}

const res = await fetch(`${base}/docs-json`);
if (!res.ok) {
  console.error(`GET ${base}/docs-json failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const doc = (await res.json()) as { paths?: Record<string, unknown> };
const out = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`Wrote ${out}: ${Object.keys(doc.paths ?? {}).length} paths`);
```

- [ ] **Step 2: Write the settings emitter**

`scripts/emit-workspace-settings.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generator/generate.js';
import { applyOverrides } from '../src/overrides.js';

const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
const doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
const manifest = applyOverrides(generateManifest(doc));

// Auto-allow read tools so demos flow without prompts; write tools
// (readonly: false) stay un-listed and trigger Claude Code's approval prompt.
const allow = manifest.filter(t => t.readonly).map(t => `mcp__monolis__${t.name}`);

const settingsDir = fileURLToPath(new URL('../../../workspace/.claude', import.meta.url));
mkdirSync(settingsDir, { recursive: true });
writeFileSync(`${settingsDir}/settings.json`, JSON.stringify({ permissions: { allow } }, null, 2));
console.log(`Allowlisted ${allow.length} read tools in workspace/.claude/settings.json`);
```

- [ ] **Step 3: Typecheck everything**

Run: `npx tsc -p packages/monolis-mcp` (from repo root) — Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: openapi fetch and workspace-settings scripts"
```

---

### Task 10: Demo workspace + staging smoke test

**Files:**
- Create: `workspace/.mcp.json`, `workspace/CLAUDE.md`
- Generated: `workspace/.claude/settings.json`, `packages/monolis-mcp/openapi.json`

**Prerequisite (user-provided):** the backend + DB clone running locally via OrbStack, and `packages/monolis-mcp/.env` with `MONOLIS_BASE_URL` (e.g. `http://localhost:3000`, no trailing slash), `MONOLIS_LOGIN_ID`, `MONOLIS_PASSWORD` (the staging test account — valid in the clone).

- [ ] **Step 1: Write `.mcp.json`**

`workspace/.mcp.json` (Claude Code spawns stdio servers with cwd = the workspace dir, so the relative path works):
```json
{
  "mcpServers": {
    "monolis": {
      "command": "npx",
      "args": ["tsx", "../packages/monolis-mcp/src/index.ts"]
    }
  }
}
```

- [ ] **Step 2: Write `workspace/CLAUDE.md`**

```markdown
# Monolis agent workspace

You are operating on Monolis, a garment-industry ERP/SCM, through MCP tools
(`mcp__monolis__*`) that call the staging backend's REST API as a test user.

## Domain glossary (draft — refine during rehearsal)

- **Sales order (SO):** an order from a buyer/brand covering one or more styles for a season.
- **Style:** a garment design; has colorways, size breakdowns, and a BOM.
- **BOM (bill of materials):** materials a style needs — fabrics (`bom-fabric`) and accessories/trims (`bom-acc`); `bom-all` aggregates.
- **Consumption:** computed required quantity of a material (`fabric-consumption`, `acc-consumption`).
- **PO-consumption** (`fabric-PO-consumption`, `acc-po-consumption`): links consumption records to purchase orders — i.e. how much of the requirement is already covered by POs.
- **Purchase order (PO):** an order to a supplier (FABRIC / ACCESSORY / OUTSOURCING / PRE_OUTSOURCING). Created FROM consumption records (`consumptionIds`).
- **sopo:** sales-order ↔ purchase-order linkage.
- **Assortment:** size/color quantity distribution for an SO.
- **Costing breakdown:** per-style cost calculation; versioned.
- **Shipment plan:** planned shipments fulfilling an SO.

## How to work

- Explore with `get_*` tools — same REST API the web app uses. Prefer filtered
  queries; responses over 40k chars are truncated.
- Mutations (`create_purchase_order`, `create_comment`) require user approval.
  Present what you intend to create (and why) before calling them.
- Shortage workflow: SO → styles → BOM → consumption vs PO-consumption
  coverage → gaps grouped by supplier and material type → one draft PO each.
- If a tool fails with 403, the test account lacks that permission — report it
  rather than retrying.
```

- [ ] **Step 3: Pull the real OpenAPI snapshot**

```bash
cd /Users/green/developer/personal/tense-ai/packages/monolis-mcp
npm run fetch-openapi
```
Expected: `Wrote .../openapi.json: <several hundred> paths`. If it fails: confirm the OrbStack backend is up (`curl $MONOLIS_BASE_URL/docs-json` should return JSON) and `MONOLIS_BASE_URL` has no trailing slash.

- [ ] **Step 4: Sanity-check the generated manifest against the snapshot**

```bash
npx tsx -e "
import { readFileSync } from 'node:fs';
import { generateManifest } from './src/generator/generate.js';
import { applyOverrides } from './src/overrides.js';
const m = applyOverrides(generateManifest(JSON.parse(readFileSync('openapi.json','utf8'))));
console.log('tools:', m.length);
console.log('long names (>50 chars):', m.filter(t => t.name.length > 50).map(t => t.name));
console.log('sample:', m.slice(0, 5).map(t => t.name));
"
```
Expected: roughly 80–150 tools; ideally zero long names. Any name over 50 chars risks the 64-char tool-name limit once Claude Code prefixes `mcp__monolis__` — add those to `excludedTools` or rename via a follow-up override.

- [ ] **Step 5: Generate the allowlist, commit the workspace**

```bash
npm run emit-settings
cd /Users/green/developer/personal/tense-ai
git add -A && git commit -m "feat: demo workspace, OpenAPI snapshot, read-tool allowlist"
```

- [ ] **Step 6: Smoke test in Claude Code**

```bash
cd /Users/green/developer/personal/tense-ai/workspace && claude
```
Checklist:
- `/mcp` shows `monolis` connected with the expected tool count.
- Ask: *"List a few sales orders and summarize one of them."* — read tools run without permission prompts.
- Ask: *"Post a comment 'MCP smoke test' on any style."* — Claude Code SHOWS AN APPROVAL PROMPT (this is the demo's safety story). Approve it to verify the write path end-to-end.
- Ask for a small PO creation and approve it — the DB is a disposable clone, so exercising `create_purchase_order` for real is safe. Verify the PO appears via `get_purchase_order*` tools (or the web app pointed at the local backend). Re-clone the DB if test data piles up.

---

### Task 11: Rehearsal and tuning loop

No new files initially — this task iterates on `overrides.ts` and `workspace/CLAUDE.md`.

- [ ] **Step 1: Run demo scenario 1 (warm-up)**

In the workspace: *"Summarize sales order \<real SO from staging\> — styles, size breakdowns, costing status, anything blocking."* Note every tool the model fumbles (wrong tool, bad params, misread response).

- [ ] **Step 2: Run demo scenario 2 (anchor, batch scale)**

*"Check all sales orders shipping in \<month with data in the clone\> for material shortages, draft POs for every shortfall, and summarize what you drafted and what needs human attention."* Verify the proposed PO bodies are sensible (correct supplier/brand/type/consumptionIds), then approve — the clone makes full end-to-end rehearsal safe. Decide whether demo day targets the local stack or real staging, and run this scenario once against that exact target.

- [ ] **Step 3: Run an off-script query**

Ask something unplanned (e.g. *"Which buyer has the most open orders this season?"*). Confirms breadth.

- [ ] **Step 4: Tune**

For each fumble: add a `descriptionOverrides` entry explaining the tool's domain meaning, or an `excludedTools` entry for noise tools, and/or extend the CLAUDE.md glossary (also correct any glossary guesses the team flags). Re-run the failing scenario after each change.

- [ ] **Step 5: Re-run tests and commit**

```bash
cd /Users/green/developer/personal/tense-ai && npx vitest run
git add -A && git commit -m "feat: tuned tool descriptions and domain glossary from rehearsal"
```

- [ ] **Step 6: Update the spec's risk section** with anything rehearsal disproved or confirmed (e.g. Swagger gaps actually encountered), and commit.

---

## Verification (overall)

1. `npx vitest run` from repo root: all suites pass.
2. `npx tsc -p packages/monolis-mcp`: clean.
3. Smoke-test checklist in Task 10 fully checked.
4. All three rehearsal scenarios in Task 11 complete without un-tuned fumbles; success criteria in the spec satisfied.
