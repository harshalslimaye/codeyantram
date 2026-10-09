export type WebFetchErrorCode = 'invalid_input' | 'permission_denied' | 'timeout' | 'cancelled'
  | 'source_too_large' | 'unsupported_content' | 'http_error' | 'network_error';

export class WebFetchError extends Error {
  constructor(readonly code: WebFetchErrorCode, message: string) {
    super(message);
    this.name = 'WebFetchError';
  }
}
