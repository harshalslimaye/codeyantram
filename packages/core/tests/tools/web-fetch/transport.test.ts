import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {Readable} from 'node:stream';
import {gzipSync, brotliCompressSync, deflateSync} from 'node:zlib';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {isPublicAddress, normalizeUrl, validateDestination} from '../../../src/tools/web-fetch/url-policy.js';
import {createWebTransport, openConnection, type ConnectionResponse} from '../../../src/tools/web-fetch/transport.js';
import {readBody} from '../../../src/tools/web-fetch/response-body.js';
import {classifyContent, decodeText} from '../../../src/tools/web-fetch/decoding.js';
import {MAX_RESPONSE_BYTES} from '../../../src/tools/web-fetch/limits.js';
import {deadline} from '../../../src/tools/web-fetch/cancellation.js';

const signal = () => new AbortController().signal;
const publicAddress = {address: '93.184.216.34', family: 4};
const resolve = async () => [publicAddress];
function response(text = 'Hello', status = 200, headers: Record<string, string> = {}): ConnectionResponse {
  return {status, headers: {'content-type': 'text/plain', ...headers}, body: Readable.from([Buffer.from(text)])};
}
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => {server.closeAllConnections(); server.close(() => done());})));
});

describe('public network policy', () => {
  it.each(['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/\n', 'data:text/plain,hello', 'https://example.com/' + 'x'.repeat(4096), 'https://example.com/' + '界'.repeat(500)])('rejects %s', input => {
    expect(() => normalizeUrl(input)).toThrowError(expect.objectContaining({code: 'invalid_input'}));
  });
  it('normalizes alternate numeric IPv4 and strips fragments before policy checks', async () => {
    expect(normalizeUrl('HTTP://Example.COM:80/a#section').href).toBe('http://example.com/a');
    for (const host of ['2130706433', '0x7f000001', '127.1', '0177.0.0.1']) {
      await expect(validateDestination(normalizeUrl(`http://${host}`), signal())).rejects.toMatchObject({code: 'permission_denied'});
    }
  });
  it.each(['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1',
    '198.18.0.1', '192.0.2.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1', '2001::1', '3fff::1', 'fe80::1%lo0'])
  ('blocks non-public or transition address %s', address => {expect(isPublicAddress(address)).toBe(false);});
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])('accepts public %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it('rejects a hostname if any DNS answer is private, empty, or mismatched', async () => {
    for (const answers of [[], [publicAddress, {address: '127.0.0.1', family: 4}], [{address: '8.8.8.8', family: 6}]]) {
      await expect(validateDestination(new URL('https://example.com'), signal(), async () => answers)).rejects.toMatchObject({code: 'permission_denied'});
    }
  });
  it('cancels a stalled DNS lookup', async () => {
    const scope = deadline(10);
    try {
      await expect(validateDestination(new URL('https://example.com'), scope.signal, () => new Promise(() => {}))).rejects.toMatchObject({code: 'timeout'});
    } finally {scope.dispose();}
  });
});

describe('transport redirects and response policy', () => {
  it('pins validated DNS answers, resolves relative redirects, and reports the final URL', async () => {
    const first = response('', 302, {location: '/docs#title'});
    const second = response('# Docs', 200, {'content-type': 'text/markdown'});
    const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const lookup = vi.fn(resolve);
    const result = await createWebTransport({resolve: lookup, open}).fetch('https://example.com/start', 'markdown', signal());
    expect(result).toMatchObject({requestedUrl: 'https://example.com/start', finalUrl: 'https://example.com/docs', text: '# Docs'});
    expect(open.mock.calls[0]![1]).toEqual([publicAddress]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(first.body.destroyed && second.body.destroyed).toBe(true);
  });
  it('rejects redirects to private IPs and DNS rebinding before connecting', async () => {
    for (const location of ['http://127.0.0.1', 'https://other.example.com']) {
      const open = vi.fn().mockResolvedValue(response('', 302, {location}));
      const lookup = vi.fn().mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([{address: '10.0.0.1', family: 4}]);
      await expect(createWebTransport({resolve: lookup, open}).fetch('https://example.com', 'text', signal())).rejects.toMatchObject({code: 'permission_denied'});
      expect(open).toHaveBeenCalledOnce();
    }
  });
  it('detects redirect loops and bounds redirect chains', async () => {
    const loop = vi.fn().mockImplementation(async () => response('', 301, {location: '/'}));
    await expect(createWebTransport({resolve, open: loop}).fetch('https://example.com', 'text', signal())).rejects.toThrow('loop');
    expect(loop).toHaveBeenCalledOnce();
    let hop = 0;
    const chain = vi.fn().mockImplementation(async () => response('', 302, {location: `/${++hop}`}));
    await expect(createWebTransport({resolve, open: chain}).fetch('https://example.com', 'text', signal())).rejects.toThrow('five redirects');
    expect(chain).toHaveBeenCalledTimes(6);
  });
  it.each([401, 403, 404, 429, 500])('sanitizes HTTP %s and destroys the unread error body', async status => {
    const reply = response('secret server body', status);
    await expect(createWebTransport({resolve, open: async () => reply}).fetch('https://example.com', 'text', signal())).rejects.toMatchObject({code: 'http_error', message: expect.stringContaining(`HTTP ${status}`)});
    expect(reply.body.destroyed).toBe(true);
  });
  it('rejects binary MIME before reading the body and sanitizes transport errors', async () => {
    const reply = response('secret bytes', 200, {'content-type': 'image/png'});
    const read = vi.spyOn(reply.body, '_read');
    await expect(createWebTransport({resolve, open: async () => reply}).fetch('https://example.com', 'text', signal())).rejects.toMatchObject({code: 'unsupported_content'});
    expect(read).not.toHaveBeenCalled();
    await expect(createWebTransport({resolve, open: async () => {throw new Error('private network details');}}).fetch('https://example.com', 'text', signal()))
      .rejects.toMatchObject({code: 'network_error', message: 'The site could not be reached or its response could not be read.'});
  });
  it('cancels connection establishment and destroys a late response', async () => {
    let release!: (reply: ConnectionResponse) => void;
    const open = vi.fn().mockImplementation(() => new Promise<ConnectionResponse>(yes => {release = yes;}));
    const scope = deadline(20);
    const pending = createWebTransport({resolve, open}).fetch('https://example.com', 'text', scope.signal);
    try { await expect(pending).rejects.toMatchObject({code: 'timeout'}); }
    finally {scope.dispose();}
    const reply = response(); release(reply);
    await Promise.resolve();
    expect(reply.body.destroyed).toBe(true);
  });
});

describe('bounded response decoding', () => {
  it.each([['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]] as const)('reads %s incrementally', async (encoding, compress) => {
    const bytes = compress('Hello नमस्कार');
    const body = Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]);
    expect((await readBody(body, {'content-encoding': encoding}, signal())).toString()).toBe('Hello नमस्कार');
    expect(body.destroyed).toBe(true);
  });
  it('rejects oversized Content-Length, actual wire data, and decompression bombs', async () => {
    for (const [body, headers] of [
      [Readable.from(['a']), {'content-length': String(MAX_RESPONSE_BYTES + 1)}],
      [Readable.from([Buffer.alloc(MAX_RESPONSE_BYTES), Buffer.from('a')]), {'content-length': '1'}],
      [Readable.from([gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 65))]), {'content-encoding': 'gzip'}],
    ] as const) {
      await expect(readBody(body, headers, signal())).rejects.toMatchObject({code: 'source_too_large'});
      expect(body.destroyed).toBe(true);
    }
  });
  it('cancels a stalled body and destroys its stream', async () => {
    const body = new Readable({read() {}});
    const controller = new AbortController();
    const pending = readBody(body, {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(body.destroyed).toBe(true);
  });
  it('honors charset, BOM fallback, UTF-8 fallback, and detects binary after decoding', () => {
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'text/plain; charset="iso-8859-1"')).toBe('café');
    expect(decodeText(Buffer.from([0xff, 0xfe, 0x48, 0, 0x69, 0]), 'text/plain')).toBe('Hi');
    expect(decodeText(Buffer.from([0xfe, 0xff, 0, 0x48, 0, 0x69]), 'text/plain; charset=unknown')).toBe('Hi');
    expect(decodeText(Buffer.from('नमस्कार'), 'text/plain; charset=unknown')).toBe('नमस्कार');
    expect(() => decodeText(Buffer.from([0, 1, 2, 3]), 'text/plain')).toThrowError(expect.objectContaining({code: 'unsupported_content'}));
    expect(classifyContent('application/problem+json')).toBe('text');
    expect(() => classifyContent('application/octet-stream')).toThrow();
  });
});

describe('native pinned HTTP connection', () => {
  it('uses the supplied address while preserving Host and sends no credentials or cookies', async () => {
    const server = createServer((request, reply) => {
      expect(request.method).toBe('GET');
      expect(request.headers.host).toMatch(/^docs\.example:/);
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers['user-agent']).toContain('Codeyantram');
      reply.setHeader('content-type', 'text/plain'); reply.end('Pinned');
    });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    // Direct low-level connection test; production destination validation rejects this local address.
    const reply = await openConnection(new URL(`http://docs.example:${address.port}`), [{address: '127.0.0.1', family: 4}], 'text', signal());
    expect((await readBody(reply.body, reply.headers, signal())).toString()).toBe('Pinned');
  });
});
