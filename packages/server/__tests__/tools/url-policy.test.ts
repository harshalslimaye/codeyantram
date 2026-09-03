import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { assertFetchable, assertPublicHost, classifyAddress, parseFetchUrl } from '../../src/tools/url-policy';

const originalAllowPrivate = process.env.WEB_FETCH_ALLOW_PRIVATE;
const originalDenyHosts = process.env.WEB_FETCH_DENY_HOSTS;

beforeEach(() => {
    delete process.env.WEB_FETCH_ALLOW_PRIVATE;
    delete process.env.WEB_FETCH_DENY_HOSTS;
});

afterEach(() => {
    if (originalAllowPrivate === undefined) delete process.env.WEB_FETCH_ALLOW_PRIVATE;
    else process.env.WEB_FETCH_ALLOW_PRIVATE = originalAllowPrivate;

    if (originalDenyHosts === undefined) delete process.env.WEB_FETCH_DENY_HOSTS;
    else process.env.WEB_FETCH_DENY_HOSTS = originalDenyHosts;
});

describe('classifyAddress', () => {
    const cases: readonly [address: string, label: string, expected: 'public' | 'private'][] = [
        ['127.0.0.1', 'IPv4 loopback', 'private'],
        ['10.1.2.3', '10.0.0.0/8', 'private'],
        ['172.16.0.1', '172.16.0.0/12 (low end)', 'private'],
        ['172.31.255.255', '172.16.0.0/12 (high end)', 'private'],
        ['172.15.255.255', 'just below 172.16.0.0/12', 'public'],
        ['192.168.1.1', '192.168.0.0/16', 'private'],
        ['169.254.1.1', '169.254.0.0/16 link-local', 'private'],
        ['100.64.0.1', '100.64.0.0/10 CGNAT', 'private'],
        ['100.128.0.1', 'just above 100.64.0.0/10', 'public'],
        ['0.0.0.0', '0.0.0.0/8', 'private'],
        ['224.0.0.1', '224.0.0.0/4 multicast', 'private'],
        ['240.0.0.1', '240.0.0.0/4 reserved', 'private'],
        ['255.255.255.255', 'broadcast', 'private'],
        ['192.0.0.1', '192.0.0.0/24 IETF protocol assignments', 'private'],
        ['198.18.0.1', '198.18.0.0/15 benchmarking (low)', 'private'],
        ['198.19.255.255', '198.18.0.0/15 benchmarking (high)', 'private'],
        ['8.8.8.8', 'a public IPv4 address', 'public'],
        ['1.1.1.1', 'a public IPv4 address', 'public'],
        ['93.184.216.34', 'a public IPv4 address', 'public'],
        ['::1', 'IPv6 loopback', 'private'],
        ['::', 'IPv6 unspecified address', 'private'],
        ['fe80::1', 'fe80::/10 link-local', 'private'],
        ['fc00::1', 'fc00::/7 unique local (fc)', 'private'],
        ['fd00::1', 'fc00::/7 unique local (fd)', 'private'],
        ['ff02::1', 'ff00::/8 multicast', 'private'],
        ['::ffff:127.0.0.1', 'IPv4-mapped loopback', 'private'],
        ['::ffff:8.8.8.8', 'IPv4-mapped public address', 'public'],
        ['64:ff9b::a00:1', 'NAT64-mapped private (10.0.0.1)', 'private'],
        ['64:ff9b::808:808', 'NAT64-mapped public (8.8.8.8)', 'public'],
        ['2606:4700:4700::1111', 'a public IPv6 address', 'public'],
        ['2001:4860:4860::8888', 'a public IPv6 address', 'public'],
    ];

    for (const [address, label, expected] of cases) {
        test(`${address} (${label}) classifies as ${expected}`, () => {
            expect(classifyAddress(address)).toBe(expected);
        });
    }

    test('a non-IP string classifies as private', () => {
        expect(classifyAddress('not-an-ip')).toBe('private');
    });
});

describe('parseFetchUrl', () => {
    test('accepts a plain https URL', () => {
        const url = parseFetchUrl('https://example.com/docs');
        expect(url.href).toBe('https://example.com/docs');
    });

    test('strips a fragment', () => {
        const url = parseFetchUrl('https://example.com/docs#section');
        expect(url.hash).toBe('');
        expect(url.href).toBe('https://example.com/docs');
    });

    test('rejects http', () => {
        expect(() => parseFetchUrl('http://example.com')).toThrow('must use https');
    });

    test('rejects file:', () => {
        expect(() => parseFetchUrl('file:///etc/passwd')).toThrow('must use https');
    });

    test('rejects data:', () => {
        expect(() => parseFetchUrl('data:text/plain,hello')).toThrow('must use https');
    });

    test('rejects embedded credentials', () => {
        expect(() => parseFetchUrl('https://user:pw@example.com')).toThrow('credentials');
    });

    test('rejects a malformed URL', () => {
        expect(() => parseFetchUrl('not a url')).toThrow('not a valid URL');
    });

    test('rejects a hostname with a trailing dot', () => {
        expect(() => parseFetchUrl('https://example.com./docs')).toThrow('invalid hostname');
    });
});

describe('assertPublicHost', () => {
    test('rejects a loopback IPv4 literal', async () => {
        await expect(assertPublicHost('127.0.0.1')).rejects.toThrow('private/internal address');
    });

    test('rejects a loopback IPv6 literal, brackets and all', async () => {
        await expect(assertPublicHost('[::1]')).rejects.toThrow('private/internal address');
    });

    test('rejects "localhost"', async () => {
        await expect(assertPublicHost('localhost')).rejects.toThrow('local/internal hostname');
    });

    test('rejects a .local suffix', async () => {
        await expect(assertPublicHost('printer.local')).rejects.toThrow('local/internal hostname');
    });

    test('rejects a .internal suffix', async () => {
        await expect(assertPublicHost('service.internal')).rejects.toThrow('local/internal hostname');
    });

    test('rejects a single-label hostname', async () => {
        await expect(assertPublicHost('devbox')).rejects.toThrow('local/internal hostname');
    });

    test('resolves and accepts a real public hostname', async () => {
        await expect(assertPublicHost('one.one.one.one')).resolves.toBeUndefined();
    });

    test('WEB_FETCH_ALLOW_PRIVATE lifts the loopback block', async () => {
        process.env.WEB_FETCH_ALLOW_PRIVATE = '1';
        await expect(assertPublicHost('127.0.0.1')).resolves.toBeUndefined();
    });

    test('WEB_FETCH_ALLOW_PRIVATE lifts the local-suffix block', async () => {
        process.env.WEB_FETCH_ALLOW_PRIVATE = '1';
        await expect(assertPublicHost('localhost')).resolves.toBeUndefined();
    });

    test('WEB_FETCH_DENY_HOSTS blocks a host even without any private-address rule matching', async () => {
        process.env.WEB_FETCH_DENY_HOSTS = 'example.com';
        await expect(assertPublicHost('example.com')).rejects.toThrow('deny list');
    });

    test('WEB_FETCH_DENY_HOSTS blocks a subdomain of a denied host', async () => {
        process.env.WEB_FETCH_DENY_HOSTS = 'example.com';
        await expect(assertPublicHost('docs.example.com')).rejects.toThrow('deny list');
    });

    test('WEB_FETCH_DENY_HOSTS still applies with WEB_FETCH_ALLOW_PRIVATE set', async () => {
        process.env.WEB_FETCH_ALLOW_PRIVATE = '1';
        process.env.WEB_FETCH_DENY_HOSTS = 'localhost';
        await expect(assertPublicHost('localhost')).rejects.toThrow('deny list');
    });

    test('a name that fails to resolve is reported plainly', async () => {
        await expect(assertPublicHost('this-domain-should-not-exist-codeyantram-test.invalid')).rejects.toThrow('could not be resolved');
    });
});

describe('assertFetchable', () => {
    test('rejects on syntax before ever touching the network', async () => {
        await expect(assertFetchable('http://127.0.0.1')).rejects.toThrow('must use https');
    });

    test('rejects a private address after parsing succeeds', async () => {
        await expect(assertFetchable('https://127.0.0.1/')).rejects.toThrow('private/internal address');
    });

    test('returns the parsed URL for an allowed host', async () => {
        const url = await assertFetchable('https://one.one.one.one/path');
        expect(url.href).toBe('https://one.one.one.one/path');
    });
});
