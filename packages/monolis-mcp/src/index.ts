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
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`monolis-mcp: missing env vars: ${missing.join(', ')} (expected in packages/monolis-mcp/.env)`);
  process.exit(1);
}

const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
let doc: unknown;
try {
  doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
} catch {
  console.error(`monolis-mcp: cannot read openapi.json at ${openapiPath} — run "npm run fetch-openapi" first`);
  process.exit(1);
}
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
