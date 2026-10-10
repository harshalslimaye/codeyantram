import {APICallError, InvalidResponseDataError, JSONParseError, TypeValidationError} from 'ai';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;

export type EvaluationErrorCode = 'missing_credentials' | 'invalid_input' | 'cancelled' | 'timeout'
  | 'authentication_failed' | 'rate_limited' | 'invalid_response' | 'provider_error';

export class EvaluationError extends Error {
  constructor(readonly code: EvaluationErrorCode, message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

/** Provider errors may contain request bodies and keys; expose only fixed messages. */
export function toEvaluationError(error: unknown): EvaluationError {
  if (error instanceof EvaluationError) return error;
  if (InvalidResponseDataError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return new EvaluationError('invalid_response', 'JEV returned an invalid evaluation response.');
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === HTTP_UNAUTHORIZED || error.statusCode === HTTP_FORBIDDEN) {
      return new EvaluationError('authentication_failed', 'JEV authentication failed. Update the TypeSafe API key through /connect.');
    }
    if (error.statusCode === HTTP_TOO_MANY_REQUESTS) return new EvaluationError('rate_limited', 'JEV is rate limited. Try again later.');
    if (TypeValidationError.isInstance(error.cause) || JSONParseError.isInstance(error.cause)) {
      return new EvaluationError('invalid_response', 'JEV returned an invalid evaluation response.');
    }
  }
  return new EvaluationError('provider_error', 'JEV could not complete the evaluation.');
}
