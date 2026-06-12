const camelToSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

// Claude Code prefixes MCP tool names with `mcp__monolis__` (14 chars). The
// Anthropic API caps the full tool name at 64 chars, leaving a 50-char budget
// for our names. Deeply nested routes can exceed this, so clampName truncates
// overlong names and appends a short stable hash to keep them unique and valid.
export const MAX_TOOL_NAME_LEN = 50;
const HASH_LEN = 6;

// FNV-1a, returns a HASH_LEN-char hex string. Dependency-free and deterministic.
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, HASH_LEN);
}

export function clampName(name: string, maxLen = MAX_TOOL_NAME_LEN): string {
  if (name.length <= maxLen) return name;
  const prefix = name.slice(0, maxLen - HASH_LEN - 1);
  return `${prefix}_${shortHash(name)}`;
}

export function toolNameFromRoute(method: string, path: string): string {
  const segments = path
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map(seg => (seg.startsWith('{') ? `by_${camelToSnake(seg.slice(1, -1))}` : camelToSnake(seg)));
  return [method, ...segments]
    .join('_')
    .replace(/-/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase();
}
