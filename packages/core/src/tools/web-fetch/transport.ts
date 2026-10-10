import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {Readable} from 'node:stream';
import {abortable} from './cancellation.js';
import {classifyContent, decodeText} from './decoding.js';
import {WebFetchError} from './errors.js';
import {MAX_REDIRECTS} from './limits.js';
import {readBody} from './response-body.js';
import type {WebFormat, WebTransport} from './types.js';
import {normalizeUrl, validateDestination, type Address, type ResolveHost} from './url-policy.js';

const HTTP_MOVED_PERMANENTLY = 301;
const HTTP_FOUND = 302;
const HTTP_SEE_OTHER = 303;
const HTTP_TEMPORARY_REDIRECT = 307;
const HTTP_PERMANENT_REDIRECT = 308;
const HTTP_SUCCESS_START = 200;
const HTTP_SUCCESS_END = 300;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const MAX_CONTENT_TYPE_CHARACTERS = 512;

export interface ConnectionResponse {status: number; headers: Record<string, string>; body: Readable}
export type OpenConnection = (url: URL, addresses: Address[], format: WebFormat, signal: AbortSignal) => Promise<ConnectionResponse>;

/** Keep the URL host for Host/SNI/certificate validation; the socket lookup uses only validated addresses. */
export const openConnection: OpenConnection = (url, addresses, format, signal) => new Promise((resolve, reject) => {
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    method: 'GET', agent: false, signal,
    lookup: (_hostname, options, callback) => {
      if (options.all === true) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
    headers: {
      'user-agent': 'Codeyantram/0.0 web-fetch',
      accept: format === 'html' ? 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8'
        : 'text/markdown,text/html;q=0.9,text/plain;q=0.8,application/json;q=0.7,application/xml;q=0.6',
      'accept-encoding': 'gzip, deflate, br',
    },
  }, response => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
    resolve({status: response.statusCode ?? 0, headers, body: response});
  });
  request.on('error', reject);
  request.end();
});

export function createWebTransport(dependencies: {resolve?: ResolveHost; open?: OpenConnection} = {}): WebTransport {
  return {async fetch(input, format, signal) {
    const requestedUrl = normalizeUrl(input).href;
    let url = normalizeUrl(input);
    const visited = new Set<string>();
    try {
      for (let redirects = 0; ; redirects++) {
        signal.throwIfAborted();
        if (visited.has(url.href)) throw new WebFetchError('http_error', 'The response contains a redirect loop.');
        visited.add(url.href);
        const addresses = await validateDestination(url, signal, dependencies.resolve);
        const pending = (dependencies.open ?? openConnection)(url, addresses, format, signal);
        // Also release late responses from an injected connection that ignored cancellation.
        void pending.then(response => { if (signal.aborted) response.body.destroy(); return; }, () => {});
        const response = await abortable(pending, signal);
        try {
          if ([HTTP_MOVED_PERMANENTLY, HTTP_FOUND, HTTP_SEE_OTHER, HTTP_TEMPORARY_REDIRECT, HTTP_PERMANENT_REDIRECT].includes(response.status)) {
            if (redirects >= MAX_REDIRECTS) throw new WebFetchError('http_error', 'The response exceeded five redirects.');
            const location = response.headers.location;
            if (!location) throw new WebFetchError('http_error', 'The redirect response has no destination.');
            url = normalizeUrl(new URL(location, url).href);
            continue;
          }
          if (response.status < HTTP_SUCCESS_START || response.status >= HTTP_SUCCESS_END) {
            const detail = response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN ? 'Authentication or access is required.'
              : response.status === HTTP_TOO_MANY_REQUESTS ? 'The site is rate limited; try again later.' : 'The site returned an unsuccessful response.';
            throw new WebFetchError('http_error', `HTTP ${response.status}. ${detail}`);
          }
          const contentType = response.headers['content-type'] ?? '';
          if (contentType.length > MAX_CONTENT_TYPE_CHARACTERS) throw new WebFetchError('unsupported_content', 'Invalid response content type.');
          classifyContent(contentType);
          const bytes = await readBody(response.body, response.headers, signal);
          return {requestedUrl, finalUrl: url.href, status: response.status, contentType, text: decodeText(bytes, contentType)};
        } finally { response.body.destroy(); }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof WebFetchError) throw error;
      throw new WebFetchError('network_error', 'The site could not be reached or its response could not be read.');
    }
  }};
}
