import {abortable, deadline} from './cancellation.js';
import {convertContent} from './content.js';
import {WebFetchError} from './errors.js';
import {DEFAULT_TIMEOUT_SECONDS} from './limits.js';
import {formatOutput} from './output.js';
import {webFetchInputSchema} from './schema.js';
import {selectContent} from './selection.js';
import {createWebTransport} from './transport.js';
import type {JevCapability, WebFetchService, WebTransport} from './types.js';

const MILLISECONDS_PER_SECOND = 1000;

export function createWebFetchService(options: {transport?: WebTransport; jev?: JevCapability} = {}): WebFetchService {
  const transport = options.transport ?? createWebTransport();
  return {async fetch(input, context = {}) {
    const parsed = webFetchInputSchema.safeParse(input);
    if (!parsed.success) throw new WebFetchError('invalid_input', 'Provide a URL, a supported format, and a timeout from 1 to 120 seconds.');
    const args = parsed.data;
    const format = args.format ?? 'markdown';
    const expiresAt = Date.now() + (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * MILLISECONDS_PER_SECOND;
    const scope = deadline((args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * MILLISECONDS_PER_SECOND, context.abortSignal);
    const {document, converted} = await (async () => {
      try {
        scope.signal.throwIfAborted();
        const fetchedDocument = await abortable(transport.fetch(args.url, format, scope.signal), scope.signal);
        const convertedContent = convertContent(fetchedDocument, format);
        if (Date.now() >= expiresAt) throw new WebFetchError('timeout', 'Web fetch timed out.');
        scope.signal.throwIfAborted();
        return {document: fetchedDocument, converted: convertedContent};
      } finally { scope.dispose(); }
    })();
    const selection = await selectContent(converted.content, document.finalUrl, format === 'html' ? 'html' : converted.format, {
      jev: options.jev, objective: args.query ?? context.objective, filter: args.filter, signal: context.abortSignal,
    });
    return formatOutput(document, converted.format, converted.content.length, selection);
  }};
}
