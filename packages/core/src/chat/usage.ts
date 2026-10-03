import type {LanguageModelUsage} from 'ai';
import type {TokenUsage} from '@codeyantram/shared';

/** Preserve unavailable counts as absent rather than reporting them as zero. */
export function toTokenUsage(usage: LanguageModelUsage): TokenUsage | undefined {
  const counts = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
  };
  const entries = Object.entries(counts).filter(([, value]) => value !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
