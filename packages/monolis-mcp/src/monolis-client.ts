import type { HttpMethod } from './manifest.js';

export const MAX_RESULT_CHARS = 40_000;

export interface MonolisClientConfig {
  baseUrl: string;
  loginId: string;
  password: string;
  fetchImpl?: typeof fetch;
}

interface CallTarget {
  method: HttpMethod;
  path: string;
}

export class MonolisClient {
  private token: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly cfg: MonolisClientConfig;

  constructor(cfg: MonolisClientConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  async login(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: this.cfg.loginId, password: this.cfg.password }),
    });
    if (!res.ok) throw new Error(`Monolis login failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('Monolis login response contained no token');
    this.token = data.token;
  }

  async call(target: CallTarget, args: Record<string, unknown>): Promise<string> {
    if (!this.token) await this.login();
    // No in-flight dedup: concurrent calls before the first login each trigger
    // their own login. Harmless for single-session PoC traffic.
    let res = await this.request(target, args);
    if (res.status === 401) {
      await this.login();
      res = await this.request(target, args);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${target.method} ${target.path} failed: ${res.status} ${text.slice(0, 2000)}`);
    }
    if (text.length > MAX_RESULT_CHARS) {
      const omitted = text.length - MAX_RESULT_CHARS;
      return `${text.slice(0, MAX_RESULT_CHARS)}\n...[truncated ${omitted} chars — narrow your query filters to see the rest]`;
    }
    return text;
  }

  private async request(target: CallTarget, args: Record<string, unknown>): Promise<Response> {
    const remaining = { ...args };
    const path = target.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = remaining[name];
      delete remaining[name];
      if (value === undefined) throw new Error(`Missing required path parameter: ${name}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(this.baseUrl + path);
    const init: RequestInit = {
      method: target.method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
    };
    if (target.method === 'GET') {
      for (const [key, value] of Object.entries(remaining)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) value.forEach(v => url.searchParams.append(key, String(v)));
        else url.searchParams.append(key, String(value));
      }
    } else {
      init.body = JSON.stringify(remaining);
    }
    return this.fetchImpl(url.toString(), init);
  }
}
