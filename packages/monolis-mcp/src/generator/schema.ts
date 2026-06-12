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
