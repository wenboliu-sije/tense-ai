export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface InputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  method: HttpMethod;
  path: string; // OpenAPI style, e.g. '/sales-order/{id}'
  readonly: boolean;
  inputSchema: InputSchema;
}
