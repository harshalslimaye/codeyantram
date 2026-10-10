import {EvaluationError} from './errors.js';

export function deadline(milliseconds: number, parent?: AbortSignal, reasons: {timeout: () => Error; cancelled: () => Error} = {
  timeout: () => new EvaluationError('timeout', 'Evaluation timed out.'),
  cancelled: () => new EvaluationError('cancelled', 'Evaluation cancelled.'),
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(reasons.timeout()), milliseconds);
  const cancel = () => controller.abort(reasons.cancelled());
  parent?.addEventListener('abort', cancel, {once: true});
  if (parent?.aborted === true) cancel();
  return {signal: controller.signal, dispose() {clearTimeout(timer); parent?.removeEventListener('abort', cancel);}};
}

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
