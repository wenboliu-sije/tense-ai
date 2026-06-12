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
    expect(po.path).toBe('/purchaseOrder');
    expect(po.inputSchema.required).toEqual([
      'purchaseOrderNo', 'type', 'brandId', 'supplierId', 'consumptionIds',
    ]);
    expect((po.inputSchema.properties.type as { enum: string[] }).enum).toContain('FABRIC');
  });
  it('filters excluded tools', () => {
    const out = applyOverrides([fake('get_a'), fake('get_b')], {
      excludedTools: ['get_a'],
      descriptionOverrides: {},
      writeTools: [],
    });
    expect(out.map(t => t.name)).toEqual(['get_b']);
  });
  it('applies description overrides without mutating the input', () => {
    const input = [fake('get_a')];
    const out = applyOverrides(input, {
      excludedTools: [],
      descriptionOverrides: { get_a: 'better' },
      writeTools: [],
    });
    expect(out[0].description).toBe('better');
    expect(input[0].description).toBe('generated');
  });
});
