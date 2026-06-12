import { describe, expect, it } from 'vitest';
import { buildInputSchema } from '../src/generator/schema.js';
import fixture from './fixtures/openapi.fixture.json';

describe('buildInputSchema', () => {
  it('maps query and path params to properties; path params and required queries are required', () => {
    const op = fixture.paths['/salesOrder'].get;
    const schema = buildInputSchema(op, fixture);
    expect(schema.properties.buyerId).toEqual({ type: 'number', description: 'Filter by buyer' });
    expect(schema.required).toEqual(['status']);
  });
  it('resolves $ref against components', () => {
    const op = fixture.paths['/salesOrder'].get;
    const schema = buildInputSchema(op, fixture);
    expect(schema.properties.status).toMatchObject({ type: 'string', enum: ['OPEN', 'CLOSED'] });
  });
  it('merges $ref with param-level description', () => {
    const op = fixture.paths['/salesOrder'].get;
    const schema = buildInputSchema(op, fixture);
    expect(schema.properties.status).toEqual({ type: 'string', enum: ['OPEN', 'CLOSED'], description: 'Order status filter' });
  });
  it('requires path params', () => {
    const op = fixture.paths['/salesOrder/{id}'].get;
    expect(buildInputSchema(op, fixture).required).toEqual(['id']);
  });
  it('handles operations with no parameters', () => {
    const op = fixture.paths['/stylePlan'].get;
    expect(buildInputSchema(op, fixture)).toEqual({ type: 'object', properties: {} });
  });
});
