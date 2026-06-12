import { describe, expect, it } from 'vitest';
import { isIncludedPath } from '../src/cluster.js';

describe('isIncludedPath', () => {
  it('includes business routes across all domains', () => {
    expect(isIncludedPath('/salesOrder')).toBe(true);
    expect(isIncludedPath('/salesOrder/{id}')).toBe(true);
    expect(isIncludedPath('/dashboard/monthly-performance')).toBe(true);
    expect(isIncludedPath('/finance/accountsReceivable')).toBe(true);
    expect(isIncludedPath('/assignLine')).toBe(true);
    expect(isIncludedPath('/user')).toBe(true); // user/master data is in-scope now
  });
  it('excludes pure-infrastructure / i18n prefixes', () => {
    expect(isIncludedPath('/auth/login')).toBe(false);
    expect(isIncludedPath('/health-check')).toBe(false);
    expect(isIncludedPath('/tool')).toBe(false);
    expect(isIncludedPath('/license')).toBe(false);
    expect(isIncludedPath('/language')).toBe(false);
    expect(isIncludedPath('/languageResource/x')).toBe(false);
  });
});
