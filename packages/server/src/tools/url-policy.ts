import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, isIPv4 } from 'node:net';

/**
 * The network equivalent of resolveInProject/resolveRealForWrite (shared.ts): the one
 * place a model-authored URL is validated before web_fetch ever opens a socket. Every
 * rejection here throws a plain sentence naming the URL, matching the error voice of
 * the filesystem guards.
 *
 * Kept dependency-free (no CIDR library) so every rule below is a single readable
 * comparison - the tradeoff is that IPv4/IPv6 range checks are written out by hand
 * instead of expressed as CIDR strings.
 */

type AddressClass = 'public' | 'private';

function classifyIPv4(address: string): AddressClass {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) {
        return 'private'; // unparseable - never trust an address we can't classify
    }
    const [a, b, c] = octets as [number, number, number, number];

    if (a === 127) return 'private'; // 127.0.0.0/8 loopback
    if (a === 10) return 'private'; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return 'private'; // 172.16.0.0/12
    if (a === 192 && b === 168) return 'private'; // 192.168.0.0/16
    if (a === 169 && b === 254) return 'private'; // 169.254.0.0/16 link-local
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // 100.64.0.0/10 carrier-grade NAT
    if (a === 0) return 'private'; // 0.0.0.0/8 "this network"
    if (a >= 224 && a <= 239) return 'private'; // 224.0.0.0/4 multicast
    if (a >= 240) return 'private'; // 240.0.0.0/4 reserved, including 255.255.255.255 broadcast
    if (a === 192 && b === 0 && c === 0) return 'private'; // 192.0.0.0/24 IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return 'private'; // 198.18.0.0/15 benchmarking

    return 'public';
}

/** Expands any valid IPv6 literal - compressed "::" form, and/or a trailing dotted-quad
 * (the tail of an IPv4-mapped or NAT64 address) - into 8 lowercase 4-hex-digit groups,
 * so classifyIPv6 only ever has to compare fixed-width groups. */
function expandIPv6(address: string): string[] {
    let working = address;

    const lastColon = working.lastIndexOf(':');
    const tail = working.slice(lastColon + 1);
    if (isIPv4(tail)) {
        const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
        const hi = ((a << 8) | b).toString(16).padStart(4, '0');
        const lo = ((c << 8) | d).toString(16).padStart(4, '0');
        working = `${working.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    const [head, tailPart] = working.includes('::') ? working.split('::') : [working, undefined];
    const headGroups = head.length > 0 ? head.split(':') : [];
    const tailGroups = tailPart !== undefined && tailPart.length > 0 ? tailPart.split(':') : [];

    const groups =
        tailPart !== undefined
            ? [...headGroups, ...Array(Math.max(8 - headGroups.length - tailGroups.length, 0)).fill('0'), ...tailGroups]
            : headGroups;

    return groups.map(group => group.padStart(4, '0').toLowerCase());
}

/** groups[6]/groups[7] hold the embedded IPv4 address in an IPv4-mapped (::ffff:0:0/96)
 * or NAT64 (64:ff9b::/96) literal - two bytes per group, high byte first. */
function embeddedIPv4(groups: string[]): string {
    const hi = groups[6]!;
    const lo = groups[7]!;
    const a = parseInt(hi.slice(0, 2), 16);
    const b = parseInt(hi.slice(2, 4), 16);
    const c = parseInt(lo.slice(0, 2), 16);
    const d = parseInt(lo.slice(2, 4), 16);
    return `${a}.${b}.${c}.${d}`;
}

function classifyIPv6(address: string): AddressClass {
    const groups = expandIPv6(address);
    if (groups.length !== 8) return 'private'; // unparseable - never trust an address we can't classify

    if (groups.every(group => group === '0000')) return 'private'; // :: - the unspecified address
    if (groups.slice(0, 7).every(group => group === '0000') && groups[7] === '0001') return 'private'; // ::1 loopback

    const g0 = parseInt(groups[0]!, 16);
    if ((g0 & 0xffc0) === 0xfe80) return 'private'; // fe80::/10 link-local
    if ((g0 & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 unique local
    if ((g0 & 0xff00) === 0xff00) return 'private'; // ff00::/8 multicast

    // ::ffff:0:0/96 - IPv4-mapped: classify the embedded IPv4 address rather than
    // treating the wrapper as public just because it's technically an IPv6 literal.
    if (groups[0] === '0000' && groups[1] === '0000' && groups[2] === '0000' && groups[3] === '0000' && groups[4] === '0000' && groups[5] === 'ffff') {
        return classifyIPv4(embeddedIPv4(groups));
    }

    // 64:ff9b::/96 - the NAT64 well-known prefix, same reasoning as the mapped case.
    if (groups[0] === '0064' && groups[1] === 'ff9b' && groups[2] === '0000' && groups[3] === '0000' && groups[4] === '0000' && groups[5] === '0000') {
        return classifyIPv4(embeddedIPv4(groups));
    }

    return 'public';
}

/** Classifies a single IP literal (v4 or v6) as public or private. Anything that isn't
 * a recognizable IP literal at all is treated as private - callers only ever pass
 * addresses already validated by node:net.isIP or returned by a DNS lookup. */
export function classifyAddress(address: string): AddressClass {
    const family = isIP(address);
    if (family === 4) return classifyIPv4(address);
    if (family === 6) return classifyIPv6(address);
    return 'private';
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function hasBlockedSuffix(hostname: string): boolean {
    return hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

/** A hostname with no dot (e.g. "myserver", "printer") almost always resolves through
 * local search-domain configuration, not the public internet - reject it as if it were
 * one of the blocked suffixes above. An IP literal never reaches this check (the caller
 * handles those separately), so this only ever sees names. */
function isSingleLabelHostname(hostname: string): boolean {
    return !hostname.includes('.');
}

/** IPv6 hostnames from the WHATWG URL parser keep their brackets (e.g. "[::1]") - every
 * check below wants the bare address. */
function stripBrackets(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function parseDenyHosts(): string[] {
    return (process.env.WEB_FETCH_DENY_HOSTS ?? '')
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(host => host.length > 0);
}

/** Exact match or subdomain match against WEB_FETCH_DENY_HOSTS. Checked before, and
 * independently of, the allow-private escape hatch - a host on the deny list stays
 * blocked even with WEB_FETCH_ALLOW_PRIVATE=1. */
function isDenied(hostname: string): boolean {
    const denied = parseDenyHosts();
    if (denied.length === 0) return false;

    const lower = hostname.toLowerCase();
    return denied.some(entry => lower === entry || lower.endsWith(`.${entry}`));
}

/**
 * Validates a hostname (already extracted from a parsed URL) against the SSRF policy:
 * an IP literal is classified directly; a name is resolved and every returned address
 * must classify as public, so a host with even one private record is rejected - the
 * cheap half of DNS-rebinding defence (see the README's "accepted limitations").
 *
 * WEB_FETCH_ALLOW_PRIVATE=1 lifts the private-address and blocked-suffix checks, for a
 * local docs server or the test fixture server - read from the environment on every
 * call, not cached, so a test can toggle it per-case. WEB_FETCH_DENY_HOSTS always
 * applies, regardless of that flag.
 */
export async function assertPublicHost(rawHostname: string): Promise<void> {
    const hostname = stripBrackets(rawHostname);

    if (isDenied(hostname)) {
        throw new Error(`"${hostname}" is on the web_fetch deny list`);
    }

    const allowPrivate = process.env.WEB_FETCH_ALLOW_PRIVATE === '1';

    const literalFamily = isIP(hostname);
    if (literalFamily !== 0) {
        if (!allowPrivate && classifyAddress(hostname) !== 'public') {
            throw new Error(`"${hostname}" is a private/internal address, which web_fetch does not reach`);
        }
        return;
    }

    if (!allowPrivate && (hasBlockedSuffix(hostname) || isSingleLabelHostname(hostname))) {
        throw new Error(`"${hostname}" is a local/internal hostname, which web_fetch does not reach`);
    }

    let records;
    try {
        records = await dnsLookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Error(`"${hostname}" could not be resolved`);
    }

    if (records.length === 0) {
        throw new Error(`"${hostname}" resolved to no addresses`);
    }

    if (allowPrivate) return;

    for (const record of records) {
        if (classifyAddress(record.address) !== 'public') {
            throw new Error(`"${hostname}" resolves to a private/internal address (${record.address}), which web_fetch does not reach`);
        }
    }
}

/** Parses and validates a fetch target's syntax: https only, no embedded credentials, a
 * real hostname, no fragment (never sent to a server, and never worth round-tripping
 * back to the model). Does not touch the network - see assertPublicHost for that. */
export function parseFetchUrl(raw: string): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`"${raw}" is not a valid URL`);
    }

    if (url.protocol !== 'https:') {
        throw new Error(`"${raw}" must use https - web_fetch does not support the ${url.protocol.replace(/:$/, '')} scheme`);
    }

    if (url.username !== '' || url.password !== '') {
        throw new Error(`"${raw}" must not include credentials in the URL`);
    }

    if (url.hostname === '' || url.hostname.endsWith('.')) {
        throw new Error(`"${raw}" has an invalid hostname`);
    }

    url.hash = '';
    return url;
}

/** The one entry point web-fetch.ts calls: validates syntax, then resolves and
 * validates the destination, throwing a plain-sentence error the first time either
 * check fails. Called again for every redirect hop, not just the original URL. */
export async function assertFetchable(raw: string): Promise<URL> {
    const url = parseFetchUrl(raw);
    await assertPublicHost(url.hostname);
    return url;
}
