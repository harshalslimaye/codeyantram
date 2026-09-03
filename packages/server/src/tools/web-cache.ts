import type { FetchCategory } from './web-fetch';

/** What one web_fetch call resolves to and remembers - the extracted text plus enough
 * of performFetch's metadata to rebuild the header block on a cache hit without
 * re-fetching. Keyed on the *requested* URL (see setCachedResource), not the final one,
 * so a second call with the exact input the model used is a hit even when the
 * underlying fetch followed a redirect. */
export type CachedResource = {
    finalUrl: string;
    fetchedAt: number;
    status: number;
    statusText: string;
    contentType: string;
    category: FetchCategory;
    redirects: number;
    truncated: boolean;
    bytes: number;
    title: string | null;
    text: string;
};

export const WEB_FETCH_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 20;
// A soft ceiling on total cached text, not a hard budget - checked after each insert,
// same as MAX_ENTRIES, so one huge page can still get cached; it just triggers eviction
// of older entries immediately afterward.
const MAX_TOTAL_CHARS = 10 * 1024 * 1024;

// Module-level, in-memory, dies with the server process - same shape as the undo
// backups in file-backups.ts. Map iteration order is insertion order, and
// setCachedResource re-inserts on every set (including a refetch of an existing key),
// so the least-recently-set entry is always first - that's what makes evict() an LRU,
// not just a FIFO over first-ever-insertion order.
const cache = new Map<string, CachedResource>();

function totalChars(): number {
    let total = 0;
    for (const entry of cache.values()) total += entry.text.length;
    return total;
}

function evict(): void {
    let total = totalChars();

    for (const [key, entry] of cache) {
        if (cache.size <= MAX_ENTRIES && total <= MAX_TOTAL_CHARS) break;
        cache.delete(key);
        total -= entry.text.length;
    }
}

/** Returns the cached entry for `requestedUrl`, or null on a miss or an expired entry
 * (which this also deletes, so it doesn't count against MAX_ENTRIES while stale). */
export function getCachedResource(requestedUrl: string): CachedResource | null {
    const entry = cache.get(requestedUrl);
    if (entry === undefined) return null;

    if (Date.now() - entry.fetchedAt > WEB_FETCH_CACHE_TTL_MS) {
        cache.delete(requestedUrl);
        return null;
    }

    return entry;
}

export function setCachedResource(requestedUrl: string, entry: CachedResource): void {
    cache.delete(requestedUrl); // re-inserting moves it to the end - see evict()'s LRU comment above
    cache.set(requestedUrl, entry);
    evict();
}

/** Test-only: clears every cached entry between test cases. Never called from
 * production code. */
export function __resetWebFetchCacheForTests(): void {
    cache.clear();
}
