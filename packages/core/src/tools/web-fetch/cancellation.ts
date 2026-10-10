import {WebFetchError} from './errors.js';

export function deadline(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new WebFetchError('timeout', 'Web fetch timed out.')), milliseconds);
  const cancel = () => controller.abort(new WebFetchError('cancelled', 'Web fetch cancelled.'));
  parent?.addEventListener('abort', cancel, {once: true});
  if (parent?.aborted === true) cancel();
  return {signal: controller.signal, dispose() {clearTimeout(timer); parent?.removeEventListener('abort', cancel);}};
}

/** Bounds DNS and injected transports even when they ignore cancellation. */
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
