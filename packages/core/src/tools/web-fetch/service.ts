import {abortable, deadline} from './cancellation.js';
import {convertContent} from './content.js';
import {WebFetchError} from './errors.js';
import {DEFAULT_TIMEOUT_SECONDS} from './limits.js';
import {formatOutput} from './output.js';
import {webFetchInputSchema} from './schema.js';
import {selectContent} from './selection.js';
import {createWebTransport} from './transport.js';
import type {JevCapability, WebFetchService, WebTransport} from './types.js';

export function createWebFetchService(options: {transport?: WebTransport; jev?: JevCapability} = {}): WebFetchService {
  const transport = options.transport ?? createWebTransport();
  return {async fetch(input, context = {}) {
    const parsed = webFetchInputSchema.safeParse(input);
    if (!parsed.success) throw new WebFetchError('invalid_input', 'Provide a URL, a supported format, and a timeout from 1 to 120 seconds.');
    const args = parsed.data;
    const format = args.format ?? 'markdown';
    const expiresAt = Date.now() + (args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const scope = deadline((args.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000, context.abortSignal);
    const {document, converted} = await (async () => {
      try {
        scope.signal.throwIfAborted();
        const document = await abortable(transport.fetch(args.url, format, scope.signal), scope.signal);
        const converted = convertContent(document, format);
        if (Date.now() >= expiresAt) throw new WebFetchError('timeout', 'Web fetch timed out.');
        scope.signal.throwIfAborted();
        return {document, converted};
      } finally { scope.dispose(); }
    })();
    const selection = await selectContent(converted.content, document.finalUrl, format === 'html' ? 'html' : converted.format, {
      jev: options.jev, objective: args.query ?? context.objective, filter: args.filter, signal: context.abortSignal,
    });
    return formatOutput(document, converted.format, converted.content.length, selection);
  }};
}
