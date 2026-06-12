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

  it('returns isError for unknown tools without touching the client', async () => {
    const call = vi.fn();
    const client = await connect(call);
    const unknown = await client.callTool({ name: 'nope', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('returns isError with the message when the client throws', async () => {
    const call = vi.fn().mockRejectedValue(new Error('GET /sales-order failed: 500'));
    const client = await connect(call);
    const failed = await client.callTool({ name: 'get_sales_order', arguments: {} });
    expect(failed.isError).toBe(true);
    expect((failed.content as Array<{ text: string }>)[0].text).toContain('500');
  });
});
