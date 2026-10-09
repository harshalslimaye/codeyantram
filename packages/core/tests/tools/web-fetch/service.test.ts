import {afterEach, describe, expect, it, vi} from 'vitest';
import {createNavigationTools, createToolExecutor, createWebFetchService, createWebFetchTool, webFetchInputSchema, type WebTransport, type NavigationGraphService} from '../../../src/index.js';

const document = {requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/docs', status: 200, contentType: 'text/html', text: '<h1>Documentation</h1><p>Use the API.</p>'};
afterEach(() => vi.useRealTimers());

describe('web fetch service and shared execution', () => {
  it('runs fetch, conversion, source framing, and disabled filtering by default', async () => {
    const transport = {fetch: vi.fn().mockResolvedValue(document)};
    const result = await createWebFetchService({transport}).fetch({url: document.requestedUrl});
    expect(result).toMatchObject({format: 'markdown', finalUrl: document.finalUrl, untrusted: true, filtering: {status: 'skipped', reason: 'disabled'}, truncation: {truncated: false}});
    expect(result.content).toContain('# Documentation');
    expect(transport.fetch).toHaveBeenCalledWith(document.requestedUrl, 'markdown', expect.any(AbortSignal));
  });
  it.each([{url: 'x', timeout: 0}, {url: 'x', timeout: 121}, {url: 'x', format: 'pdf'}, {url: 'x', query: ' '}, {url: 'x', cookies: 'private'}, {url: 'x', filter: 'true'}])('rejects unsupported arguments (case %#)', input => {
    expect(webFetchInputSchema.safeParse(input).success).toBe(false);
  });
  it('enforces default and custom deadlines even for non-cooperative transports', async () => {
    vi.useFakeTimers();
    for (const timeout of [undefined, 1]) {
      const transport: WebTransport = {fetch: vi.fn<WebTransport['fetch']>(() => new Promise(() => {}))};
      const pending = createWebFetchService({transport}).fetch({url: document.requestedUrl, timeout});
      const checked = expect(pending).rejects.toMatchObject({code: 'timeout'});
      await vi.advanceTimersByTimeAsync((timeout ?? 30) * 1000);
      await checked;
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('does no fetching for pre-cancelled calls and aborts in-flight requests', async () => {
    const transport: WebTransport = {fetch: vi.fn<WebTransport['fetch']>(() => new Promise(() => {}))};
    const service = createWebFetchService({transport});
    await expect(service.fetch({url: document.requestedUrl}, {abortSignal: AbortSignal.abort()})).rejects.toMatchObject({code: 'cancelled'});
    expect(transport.fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = service.fetch({url: document.requestedUrl}, {abortSignal: controller.signal});
    controller.abort();
    await expect(pending).rejects.toMatchObject({code: 'cancelled'});
  });
  it('shares twelve executions between navigation and web tools', async () => {
    const execute = createToolExecutor();
    const graph = createNavigationTools({getStatus: () => ({lifecycle: 'unopened', graph: null})} as NavigationGraphService, execute);
    const transport = {fetch: vi.fn().mockResolvedValue(document)};
    const web = createWebFetchTool(createWebFetchService({transport}), execute);
    for (let i = 0; i < 12; i++) {
      const options = {toolCallId: String(i), messages: [], context: {}};
      const result = i % 2 ? await graph.graph.execute!({}, options) : await web.execute!({url: document.requestedUrl}, options);
      expect(result).toMatchObject({status: 'success'});
    }
    expect(await web.execute!({url: document.requestedUrl}, {toolCallId: 'extra', messages: [], context: {}})).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
    expect(transport.fetch).toHaveBeenCalledTimes(6);
  });
});
