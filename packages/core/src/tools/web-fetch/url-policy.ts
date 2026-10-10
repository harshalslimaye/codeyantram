import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {abortable} from './cancellation.js';
import {WebFetchError} from './errors.js';
import {MAX_URL_CHARACTERS} from './limits.js';

const GLOBAL_UNICAST_PREFIX_LENGTH = 3;
const SPECIAL_ALLOCATIONS_PREFIX_LENGTH = 23;
const DOCUMENTATION_PREFIX_LENGTH = 20;

export type Address = {address: string; family: number};
export type ResolveHost = (hostname: string) => Promise<Address[]>;
const resolveHost: ResolveHost = hostname => lookup(hostname, {all: true, order: 'verbatim'});

export function normalizeUrl(input: string): URL {
  try {
    // oxlint-disable-next-line no-control-regex -- Reject control characters and spaces in URL input.
    if (input.length > MAX_URL_CHARACTERS || /[\u0000-\u0020\u007f]/u.test(input)) throw new Error('URL input is too long or contains forbidden characters.');
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL protocol or credentials are not supported.');
    url.hash = '';
    if (url.href.length > MAX_URL_CHARACTERS) throw new Error('Normalized URL exceeds the character limit.');
    return url;
  } catch { throw new WebFetchError('invalid_input', 'Use a public HTTP or HTTPS URL without credentials.'); }
}

export function isPublicAddress(address: string): boolean {
  if (!isIP(address) || address.includes('%')) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  // IPv6 must be ordinary global unicast, excluding transition mechanisms and special allocations.
  if (parsed.kind() === 'ipv6') {
    const ipv6 = parsed as ipaddr.IPv6;
    return ipv6.match(ipaddr.IPv6.parse('2000::'), GLOBAL_UNICAST_PREFIX_LENGTH)
      && !ipv6.match(ipaddr.IPv6.parse('2001::'), SPECIAL_ALLOCATIONS_PREFIX_LENGTH)
      && !ipv6.match(ipaddr.IPv6.parse('3fff::'), DOCUMENTATION_PREFIX_LENGTH);
  }
  return true;
}

export async function validateDestination(url: URL, signal: AbortSignal, resolve: ResolveHost = resolveHost): Promise<Address[]> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{address: hostname, family: isIP(hostname)}]
    : await abortable(resolve(hostname), signal);
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) {
    throw new WebFetchError('permission_denied', 'Web fetch only allows public network destinations.');
  }
  return addresses;
}
