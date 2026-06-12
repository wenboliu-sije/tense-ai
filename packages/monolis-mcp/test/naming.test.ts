import { describe, expect, it } from 'vitest';
import { clampName, MAX_TOOL_NAME_LEN, toolNameFromRoute } from '../src/generator/naming.js';

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
  it('snake_cases camelCase route segments (real API style)', () => {
    expect(toolNameFromRoute('GET', '/salesOrder')).toBe('get_sales_order');
    expect(toolNameFromRoute('GET', '/salesOrder/{id}')).toBe('get_sales_order_by_id');
    expect(toolNameFromRoute('GET', '/stylePlan')).toBe('get_style_plan');
  });
});

describe('clampName', () => {
  it('leaves names within budget untouched', () => {
    expect(clampName('get_sales_order')).toBe('get_sales_order');
    expect(clampName('x'.repeat(MAX_TOOL_NAME_LEN))).toHaveLength(MAX_TOOL_NAME_LEN);
  });
  it('truncates overlong names to the budget with a hash suffix', () => {
    const long = 'get_' + 'a'.repeat(80);
    const clamped = clampName(long);
    expect(clamped.length).toBe(MAX_TOOL_NAME_LEN);
    expect(clamped).toMatch(/^get_a+_[0-9a-f]{6}$/);
  });
  it('is deterministic and distinguishes names that share a long prefix', () => {
    const a = 'get_' + 'a'.repeat(60) + '_fabric';
    const b = 'get_' + 'a'.repeat(60) + '_accessory';
    expect(clampName(a)).toBe(clampName(a));
    expect(clampName(a)).not.toBe(clampName(b));
  });
});
