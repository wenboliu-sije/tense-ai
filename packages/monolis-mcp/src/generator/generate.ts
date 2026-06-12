import { isIncludedPath } from '../cluster.js';
import type { ToolDef } from '../manifest.js';
import { clampName, toolNameFromRoute } from './naming.js';
import { buildInputSchema } from './schema.js';

interface OpenAPIDoc {
  paths?: Record<string, Record<string, unknown>>;
}

export function generateManifest(doc: unknown): ToolDef[] {
  const tools: ToolDef[] = [];
  const used = new Set<string>();
  for (const [path, ops] of Object.entries((doc as OpenAPIDoc).paths ?? {})) {
    if (!isIncludedPath(path)) continue;
    const op = ops['get'] as { summary?: string; description?: string } | undefined;
    if (!op) continue;
    const base = toolNameFromRoute('GET', path);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    // Clamp after dedupe so the (unique) final name feeds the hash; clamped
    // names stay unique because the hash is taken over the full pre-clamp name.
    name = clampName(name);
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
