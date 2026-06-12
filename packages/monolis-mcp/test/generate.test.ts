import { describe, expect, it } from 'vitest';
import { generateManifest } from '../src/generator/generate.js';
import fixture from './fixtures/openapi.fixture.json';

describe('generateManifest', () => {
  const manifest = generateManifest(fixture);

  it('emits one read tool per included GET, sorted by name', () => {
    expect(manifest.map(t => t.name)).toEqual([
      'get_sales_order',
      'get_sales_order_by_id',
      'get_style_plan',
      'get_user',
    ]);
  });
  it('skips non-GET methods but keeps business GETs like /user', () => {
    expect(manifest.find(t => t.method !== 'GET')).toBeUndefined();
    expect(manifest.find(t => t.path === '/user')).toBeDefined();
  });
  it('marks tools readonly with summary as description', () => {
    const t = manifest.find(t => t.name === 'get_sales_order')!;
    expect(t.readonly).toBe(true);
    expect(t.description).toBe('List sales orders');
    expect(t.inputSchema.properties).toHaveProperty('buyerId');
  });
  it('dedupes colliding tool names with numeric suffixes', () => {
    const doc = {
      paths: {
        '/style/x-y': { get: { summary: 'a' } },
        '/style/x_y': { get: { summary: 'b' } },
      },
    };
    expect(generateManifest(doc).map(t => t.name)).toEqual(['get_style_x_y', 'get_style_x_y_2']);
  });
});
