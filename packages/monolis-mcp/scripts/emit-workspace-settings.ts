import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateManifest } from '../src/generator/generate.js';
import { applyOverrides } from '../src/overrides.js';

const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
let doc: unknown;
try {
  doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
} catch {
  console.error(`Cannot read ${openapiPath} — run "npm run fetch-openapi" first`);
  process.exit(1);
}
const manifest = applyOverrides(generateManifest(doc));

// Auto-allow read tools so demos flow without prompts; write tools
// (readonly: false) stay un-listed and trigger Claude Code's approval prompt.
const allow = manifest.filter(t => t.readonly).map(t => `mcp__monolis__${t.name}`);

const settingsDir = fileURLToPath(new URL('../../../workspace/.claude', import.meta.url));
mkdirSync(settingsDir, { recursive: true });
writeFileSync(`${settingsDir}/settings.json`, JSON.stringify({ permissions: { allow } }, null, 2));
console.log(`Allowlisted ${allow.length} read tools in workspace/.claude/settings.json`);
