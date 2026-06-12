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
