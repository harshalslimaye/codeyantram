import {captureRejection, requireValue, asymmetric} from '../../../../shared/tests/helpers.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createNavigationTools, createToolExecutor, createWebFetchService, createWebFetchTool, webFetchInputSchema, type WebTransport, type NavigationGraphService} from '../../../src/index.js';

const document = {requestedUrl: 'https://example.com/', finalUrl: 'https://example.com/docs', status: 200, contentType: 'text/html', text: '<h1>Documentation</h1><p>Use the API.</p>'};
afterEach(() => vi.useRealTimers());

describe('web fetch service and shared execution', () => {
  it.each(['markdown', 'text', 'html'] as const)('applies host-enabled JEV to %s output and rejects filter overrides', async format => {
    const transport = {fetch: vi.fn<WebTransport['fetch']>().mockResolvedValue({...document, text: '<h1>Docs</h1>' + '<p>Useful evidence.</p>'.repeat(600)})};
    const evaluate = vi.fn<() => Promise<never>>(async () => {throw new Error('fixture failure');});
    const service = createWebFetchService({transport, jev: {status: 'available', evaluator: {evaluate}}});
    const bypass = {url: document.requestedUrl, filter: false};
    await expect(service.fetch(bypass)).rejects.toMatchObject({code: 'invalid_input'});
    expect(transport.fetch).not.toHaveBeenCalled();
    const result = await service.fetch({url: document.requestedUrl, format}, {objective: 'Read docs'});
    expect(evaluate).toHaveBeenCalled();
    expect(result.filtering.status).toBe('failed');
  });
  it('runs fetch, conversion, source framing, and disabled filtering by default', async () => {
    const transport = {fetch: vi.fn<WebTransport["fetch"]>().mockResolvedValue(document)};
    const result = await createWebFetchService({transport}).fetch({url: document.requestedUrl});
    expect(result).toMatchObject({format: 'markdown', finalUrl: document.finalUrl, untrusted: true, filtering: {status: 'skipped', reason: 'disabled'}, truncation: {truncated: false}});
    expect(result.content).toContain('# Documentation');
    expect(transport.fetch).toHaveBeenCalledWith(document.requestedUrl, 'markdown', asymmetric.any(AbortSignal));
  });
  it.each([{url: 'x', timeout: 0}, {url: 'x', timeout: 121}, {url: 'x', format: 'pdf'}, {url: 'x', query: ' '}, {url: 'x', cookies: 'private'}, {url: 'x', filter: 'true'}, {url: 'x', filter: false}, {url: 'x', filter: true}])('rejects unsupported arguments (case %#)', input => {
    expect(webFetchInputSchema.safeParse(input).success).toBe(false);
  });
  it('enforces default and custom deadlines even for non-cooperative transports', async () => {
    vi.useFakeTimers();
    for (const timeout of [undefined, 1]) {
      const transport: WebTransport = {fetch: vi.fn<WebTransport['fetch']>(() => new Promise(() => {}))};
      const pending = createWebFetchService({transport}).fetch({url: document.requestedUrl, timeout});
      const checked = captureRejection(pending);
      await vi.advanceTimersByTimeAsync((timeout ?? 30) * 1000);
      expect(await checked).toMatchObject({code: 'timeout'});
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
  it('shares the twenty-call budget between navigation and web fetch', async () => {
    const execute = createToolExecutor();
    const graph = createNavigationTools({getStatus: () => ({lifecycle: 'unopened', graph: null})} as NavigationGraphService, execute);
    const transport = {fetch: vi.fn<WebTransport["fetch"]>().mockResolvedValue(document)};
    const web = createWebFetchTool(createWebFetchService({transport}), execute);
    for (let i = 0; i < 20; i++) {
      const options = {toolCallId: String(i), messages: [], context: {}};
      const result = i % 2 ? await requireValue(graph.graph.execute)({}, options) : await requireValue(web.execute)({url: document.requestedUrl}, options);
      expect(result).toMatchObject({status: 'success'});
    }
    expect(await requireValue(web.execute)({url: document.requestedUrl}, {toolCallId: 'extra', messages: [], context: {}})).toMatchObject({status: 'error', error: {code: 'tool_limit'}});
    expect(transport.fetch).toHaveBeenCalledTimes(10);
  });
});
