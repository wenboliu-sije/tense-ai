import { describe, expect, it, vi } from 'vitest';
import { MAX_RESULT_CHARS, MonolisClient } from '../src/monolis-client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const makeClient = (fetchImpl: typeof fetch) =>
  new MonolisClient({ baseUrl: 'https://staging.test', loginId: 'tester', password: 'pw', fetchImpl });

describe('MonolisClient', () => {
  it('logs in lazily and sends the bearer token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 'jwt-1' })) // login
      .mockResolvedValueOnce(json([{ id: 1 }]));       // api call
    const client = makeClient(fetchImpl);
    const result = await client.call({ method: 'GET', path: '/sales-order' }, {});
    expect(result).toBe('[{"id":1}]');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.test/auth/login');
    const init = fetchImpl.mock.calls[1][1];
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
  });

  it('substitutes path params and maps the rest to query (arrays appended per element)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({}));
    await makeClient(fetchImpl).call(
      { method: 'GET', path: '/sales-order/{id}' },
      { id: 7, status: 'OPEN', tags: ['a', 'b'] },
    );
    const url = fetchImpl.mock.calls[1][0] as string;
    expect(url).toBe('https://staging.test/sales-order/7?status=OPEN&tags=a&tags=b');
  });

  it('sends non-GET args as JSON body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({ id: 99 }));
    await makeClient(fetchImpl).call({ method: 'POST', path: '/comment' }, { content: 'hi', styleId: 3 });
    const init = fetchImpl.mock.calls[1][1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ content: 'hi', styleId: 3 });
  });

  it('re-logs-in once on 401 and retries', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(json({ ok: true }));
    const result = await makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {});
    expect(result).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws on non-OK responses with status and body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {})).rejects.toThrow(
      'GET /style failed: 500 boom',
    );
  });

  it('truncates oversized responses with a hint', async () => {
    const big = 'x'.repeat(MAX_RESULT_CHARS + 100);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(new Response(big, { status: 200 }));
    const result = await makeClient(fetchImpl).call({ method: 'GET', path: '/style' }, {});
    expect(result.length).toBeLessThan(big.length);
    expect(result).toContain('truncated');
    expect(result).toContain('narrow');
  });

  it('tolerates a trailing slash in baseUrl', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({}));
    const client = new MonolisClient({ baseUrl: 'https://staging.test/', loginId: 'u', password: 'p', fetchImpl });
    await client.call({ method: 'GET', path: '/style' }, {});
    expect(fetchImpl.mock.calls[0][0]).toBe('https://staging.test/auth/login');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://staging.test/style');
  });

  it('throws if the retried request also returns 401', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ token: 'a' }))
      .mockResolvedValueOnce(new Response('x', { status: 401 }))
      .mockResolvedValueOnce(json({ token: 'b' }))
      .mockResolvedValueOnce(new Response('still expired', { status: 401 }));
    await expect(makeClient(fetchImpl).call({ method: 'GET', path: '/x' }, {}))
      .rejects.toThrow('GET /x failed: 401');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
