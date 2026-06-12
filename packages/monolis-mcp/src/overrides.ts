import type { ToolDef } from './manifest.js';

// Tools that confuse more than help. Populated during rehearsal (Task 11).
export const excludedTools: string[] = [];

// Better descriptions for tools whose generated summary is missing or opaque,
// or whose required params accept values the OpenAPI doc doesn't enumerate
// (NestJS enforces them at runtime, so the schema can't know). Populated during
// rehearsal (Task 11) as the model fumbles tools.
export const descriptionOverrides: Record<string, string> = {
  get_sales_order:
    'List sales orders (paginated). Required: page (1-based), take (page size), ' +
    'status (one of "Draft", "Complete", "Closed"), and orderDirection ("ASC" or "DESC"). ' +
    'Optional filters include season, year, buyer, brand, styleNumber, orderType. ' +
    'Start here to find sales orders to analyze, then drill into a specific order by id.',
  get_assort:
    'Get the size/color assortment (quantity distribution) for a style plan. ' +
    'Required: stylePlanId (get it from a style plan via get_style_plan tools).',
};

export interface OverrideConfig {
  excludedTools: string[];
  descriptionOverrides: Record<string, string>;
  writeTools: ToolDef[];
}

export const writeTools: ToolDef[] = [
  {
    name: 'create_purchase_order',
    description:
      'Create a draft purchase order (PO) for a supplier. A PO is created FROM material consumption records: ' +
      'gather consumption IDs via fabric-consumption / acc-consumption read tools, then pass them as consumptionIds. ' +
      'One PO targets one supplier and one material type.',
    method: 'POST',
    path: '/purchaseOrder',
    readonly: false,
    inputSchema: {
      type: 'object',
      properties: {
        purchaseOrderNo: {
          type: 'string',
          description: 'PO code, letters/digits/dashes, e.g. VUORI-CC-FA-25-1234567890. Must not contain * ? : \\ / [ ] < > "',
        },
        type: {
          type: 'string',
          enum: ['FABRIC', 'ACCESSORY', 'OUTSOURCING', 'PRE_OUTSOURCING'],
          description: 'What kind of material/service this PO purchases',
        },
        year: { type: 'string', description: 'Year, e.g. "2025"' },
        season: { type: 'string', description: 'Season code, e.g. "SS27"' },
        brandId: { type: 'number', description: 'Brand the PO belongs to' },
        supplierId: { type: 'number', description: 'Supplier receiving the PO' },
        consumptionIds: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          description: 'IDs of the consumption records this PO fulfills (must be unique)',
        },
      },
      required: ['purchaseOrderNo', 'type', 'brandId', 'supplierId', 'consumptionIds'],
    },
  },
  {
    name: 'create_comment',
    description: 'Post a comment on a style (visible to the team in the Monolis web app).',
    method: 'POST',
    path: '/comment',
    readonly: false,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Comment text' },
        styleId: { type: 'number', description: 'Style to comment on' },
        images: { type: 'array', items: { type: 'string' }, description: 'Image URLs; pass [] if none' },
      },
      required: ['content', 'styleId', 'images'],
    },
  },
];

// The defaults ARE the production config: index.ts (served manifest) and
// scripts/emit-workspace-settings.ts (allowlist) both call this with no config,
// so rehearsal tuning must edit the module-level consts above — otherwise the
// served tools and the workspace allowlist drift apart.
export function applyOverrides(
  generated: ToolDef[],
  config: OverrideConfig = { excludedTools, descriptionOverrides, writeTools },
): ToolDef[] {
  const kept = generated
    .filter(t => !config.excludedTools.includes(t.name))
    .map(t =>
      config.descriptionOverrides[t.name]
        ? { ...t, description: config.descriptionOverrides[t.name] }
        : t,
    );
  return [...kept, ...config.writeTools];
}
