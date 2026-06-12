import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const base = process.env.MONOLIS_BASE_URL;
if (!base) {
  console.error('Set MONOLIS_BASE_URL in packages/monolis-mcp/.env first');
  process.exit(1);
}

const baseUrl = base.replace(/\/+$/, '');
const res = await fetch(`${baseUrl}/docs-json`);
if (!res.ok) {
  console.error(`GET ${baseUrl}/docs-json failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
let doc: { paths?: Record<string, unknown> };
try {
  doc = (await res.json()) as { paths?: Record<string, unknown> };
} catch {
  console.error(`GET ${baseUrl}/docs-json did not return JSON — is MONOLIS_BASE_URL pointing at the backend (not the web app)?`);
  process.exit(1);
}
const out = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`Wrote ${out}: ${Object.keys(doc.paths ?? {}).length} paths`);
