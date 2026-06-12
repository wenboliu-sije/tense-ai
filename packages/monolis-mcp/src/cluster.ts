// We expose every GET endpoint as a read tool so the agent has full cross-domain
// coverage (order status, materials, production, logistics, costing/finance,
// dashboards) — the PoC workflows from the PM/CEO span all of these. We exclude
// only top-level prefixes that are pure infrastructure or i18n, not business
// operations: they would add tool-selection noise without enabling any workflow.
// Finer pruning (specific tools that confuse the model) is done per-tool via
// overrides.excludedTools during rehearsal.
export const EXCLUDED_SEGMENTS = new Set([
  'auth',
  'health-check',
  'tool',
  'license',
  'language',
  'languageResource',
]);

export function isIncludedPath(path: string): boolean {
  const first = path.replace(/^\//, '').split('/')[0];
  return !EXCLUDED_SEGMENTS.has(first);
}
