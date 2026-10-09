import {createJevEvaluator, type JevCapability} from '@codeyantram/core';
import {resolveJevConfiguration} from '@codeyantram/shared';

/** Resolve from the same snapshot as coding credentials; bind every evaluation to the HTTP request. */
export function resolveJevCapability(config: Record<string, unknown>, signal: AbortSignal, create = createJevEvaluator): JevCapability {
  const settings = resolveJevConfiguration(config);
  if (!settings.enabled) return {status: 'disabled'};
  if (!settings.configured) return {status: 'unavailable', reason: 'missing_credentials'};
  try {
    const apiKey = (config.providers as {typesafe: {apiKey: string}}).typesafe.apiKey.trim();
    const evaluator = create({apiKey});
    return {status: 'available', evaluator: {evaluate: input => evaluator.evaluate({...input,
      abortSignal: input.abortSignal ? AbortSignal.any([signal, input.abortSignal]) : signal,
    })}};
  } catch { return {status: 'unavailable', reason: 'initialization_failed'}; }
}
