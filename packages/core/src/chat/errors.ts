import {AISDKError, APICallError} from 'ai';
import type {ChatErrorCode, ChatStreamEvent} from '@codeyantram/shared';
import {ChatGPTAdapterError} from '@codeyantram/ai-sdk-provider-chatgpt';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAVAILABLE = 503;

function diagnostic(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.[\]-]{1,128}$/.test(value) ? value : undefined;
}

// oxlint-disable-next-line eslint/complexity -- Each documented ChatGPT failure code has distinct recovery guidance.
function chatgptApiError(error: APICallError): Extract<ChatStreamEvent, {type: 'error'}> | undefined {
  const data = error.data;
  if (data === null || typeof data !== 'object' || !('provider' in data) || data.provider !== 'chatgpt') return;
  const details = data as Record<string, unknown>;
  const code = diagnostic(details.code);
  const param = diagnostic(details.param);
  const requestId = diagnostic(details.requestId);
  const status = error.statusCode;
  const reference = requestId === undefined ? '' : ` Request ID: ${requestId}.`;
  const diagnosticText = `${status === undefined ? '' : `HTTP ${status}`}${code === undefined ? '' : `${status === undefined ? '' : ', '}${code}`}${param === undefined ? '' : `; field: ${param}`}`;
  const suffix = diagnosticText === '' ? '' : ` (${diagnosticText})`;
  if (code === 'subscription_sharing_usage_limit_exceeded' || status === HTTP_TOO_MANY_REQUESTS) {
    return {type: 'error', code: 'rate_limited', message: `ChatGPT plan usage limit reached${suffix}. Check ChatGPT Settings → Usage.${reference}`};
  }
  if (code === 'subscription_sharing_unsupported_capability') {
    return {type: 'error', code: 'provider_error', message: `ChatGPT rejected an unsupported request capability${suffix}.${reference}`};
  }
  if (code === 'subscription_sharing_user_not_eligible') {
    return {type: 'error', code: 'provider_error', message: `This ChatGPT account or workspace is not eligible for plan usage${suffix}.${reference}`};
  }
  if (code === 'subscription_sharing_route_not_supported') {
    return {type: 'error', code: 'provider_error', message: `ChatGPT plan usage does not support this request route${suffix}.${reference}`};
  }
  if (code === 'chatpass_v2_scope_not_authorized' || code === 'chatpass_v2_invalid_authorization_context') {
    return {type: 'error', code: 'provider_error', message: `ChatGPT plan permission was not authorized for this integration${suffix}.${reference}`};
  }
  if (status === HTTP_UNAUTHORIZED || code === 'subscription_sharing_invalid_user') {
    return {type: 'error', code: 'provider_error', message: `ChatGPT did not accept the selected account or permission${suffix}. Check the connection in /chatgpt status.${reference}`};
  }
  if (status === HTTP_FORBIDDEN) {
    return {type: 'error', code: 'provider_error', message: `ChatGPT denied this request${suffix}. Check account, workspace, and region access.${reference}`};
  }
  if (status === HTTP_UNAVAILABLE || code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') {
    return {type: 'error', code: 'provider_error', message: `ChatGPT plan service is temporarily unavailable${suffix}. Try again later.${reference}`};
  }
  return {type: 'error', code: 'provider_error', message: `ChatGPT could not complete the response${suffix}.${reference}`};
}

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode, message: string) {
    super(message);
    this.name = 'ChatError';
  }
}

// Provider errors may include response bodies or request details. Keep those
// out of the public stream and return a message appropriate for the category.
// oxlint-disable-next-line eslint/complexity -- This boundary maps each safe provider error category into the public stream.
export function toChatErrorEvent(
  error: unknown,
  fallback: 'provider_error' | 'internal_error' = 'internal_error',
): Extract<ChatStreamEvent, {type: 'error'}> {
  if (error instanceof ChatError) {
    return {type: 'error', code: error.code, message: error.message};
  }
  if (error instanceof ChatGPTAdapterError) {
    return {type: 'error', code: 'provider_error', message: error.message};
  }
  if (APICallError.isInstance(error)) {
    const chatgpt = chatgptApiError(error);
    if (chatgpt !== undefined) return chatgpt;
  }
  if (APICallError.isInstance(error) && error.statusCode === HTTP_TOO_MANY_REQUESTS) {
    return {type: 'error', code: 'rate_limited', message: 'The provider rate limit was reached. Try again later.'};
  }
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    return {type: 'error', code: 'provider_error', message: `The model provider rejected the request (HTTP ${error.statusCode}). Check the active model and its credentials.`};
  }
  if (AISDKError.isInstance(error) || fallback === 'provider_error') {
    return {type: 'error', code: 'provider_error', message: 'The model provider could not complete the response.'};
  }
  return {type: 'error', code: 'internal_error', message: 'The chat response could not be completed.'};
}
