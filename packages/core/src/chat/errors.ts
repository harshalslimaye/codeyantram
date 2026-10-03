import {AISDKError, APICallError} from 'ai';
import type {ChatErrorCode, ChatStreamEvent} from '@codeyantram/shared';

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode, message: string) {
    super(message);
    this.name = 'ChatError';
  }
}

// Provider errors may include response bodies or request details. Keep those
// out of the public stream and return a message appropriate for the category.
export function toChatErrorEvent(
  error: unknown,
  fallback: 'provider_error' | 'internal_error' = 'internal_error',
): Extract<ChatStreamEvent, {type: 'error'}> {
  if (error instanceof ChatError) {
    return {type: 'error', code: error.code, message: error.message};
  }
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return {type: 'error', code: 'rate_limited', message: 'The provider rate limit was reached. Try again later.'};
  }
  if (AISDKError.isInstance(error) || fallback === 'provider_error') {
    return {type: 'error', code: 'provider_error', message: 'The model provider could not complete the response.'};
  }
  return {type: 'error', code: 'internal_error', message: 'The chat response could not be completed.'};
}
