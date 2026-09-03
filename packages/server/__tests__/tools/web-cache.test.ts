import { beforeEach, describe, expect, test } from 'bun:test';
import { __resetWebFetchCacheForTests, getCachedResource, setCachedResource, WEB_FETCH_CACHE_TTL_MS, type CachedResource } from '../../src/tools/web-cache';

function makeEntry(overrides: Partial<CachedResource> = {}): CachedResource {
    return {
        finalUrl: 'https://example.com/',
        fetchedAt: Date.now(),
        status: 200,
        statusText: 'OK',
        contentType: 'text/plain',
        category: 'text',
        redirects: 0,
        truncated: false,
        bytes: 5,
        title: null,
        text: 'hello',
        ...overrides,
    };
}

beforeEach(() => {
    __resetWebFetchCacheForTests();
});

describe('getCachedResource / setCachedResource', () => {
    test('returns null on a miss', () => {
        expect(getCachedResource('https://nope.example.com/')).toBeNull();
    });

    test('returns what was set', () => {
        const entry = makeEntry({ text: 'stored value' });
        setCachedResource('https://example.com/a', entry);
        expect(getCachedResource('https://example.com/a')?.text).toBe('stored value');
    });

    test('keys are exact - a different URL is a miss', () => {
        setCachedResource('https://example.com/a', makeEntry());
        expect(getCachedResource('https://example.com/b')).toBeNull();
    });

    test('expires an entry past the TTL', () => {
        setCachedResource('https://example.com/a', makeEntry({ fetchedAt: Date.now() - WEB_FETCH_CACHE_TTL_MS - 1 }));
        expect(getCachedResource('https://example.com/a')).toBeNull();
    });

    test('does not expire an entry just under the TTL', () => {
        setCachedResource('https://example.com/a', makeEntry({ fetchedAt: Date.now() - (WEB_FETCH_CACHE_TTL_MS - 1000) }));
        expect(getCachedResource('https://example.com/a')).not.toBeNull();
    });

    test('evicts the oldest entry once past the entry-count cap', () => {
        for (let i = 0; i < 21; i++) {
            setCachedResource(`https://example.com/${i}`, makeEntry());
        }

        expect(getCachedResource('https://example.com/0')).toBeNull(); // oldest, evicted
        expect(getCachedResource('https://example.com/20')).not.toBeNull(); // newest, kept
    });

    test('re-setting an existing key refreshes its LRU position instead of duplicating it', () => {
        for (let i = 0; i < 19; i++) {
            setCachedResource(`https://example.com/${i}`, makeEntry());
        }
        // Touch the oldest entry so it's no longer the least-recently-set.
        setCachedResource('https://example.com/0', makeEntry({ text: 'refreshed' }));

        // Adding one more would evict the (now-oldest) entry #1, not #0.
        setCachedResource('https://example.com/19', makeEntry());
        setCachedResource('https://example.com/20', makeEntry());

        expect(getCachedResource('https://example.com/0')?.text).toBe('refreshed');
        expect(getCachedResource('https://example.com/1')).toBeNull();
    });

    test('evicts oldest entries once past the total-character budget', () => {
        const big = 'x'.repeat(6 * 1024 * 1024);
        setCachedResource('https://example.com/first', makeEntry({ text: big }));
        setCachedResource('https://example.com/second', makeEntry({ text: big }));

        // Together the two entries exceed the 10 MB budget - the older one should be gone.
        expect(getCachedResource('https://example.com/first')).toBeNull();
        expect(getCachedResource('https://example.com/second')).not.toBeNull();
    });
});
