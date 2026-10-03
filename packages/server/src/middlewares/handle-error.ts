import type {ErrorRequestHandler} from 'express';
import type {ChatStreamEvent} from '@codeyantram/shared';

export const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  let errorType: unknown;
  let errorStatus: unknown;
  if (typeof error === 'object' && error !== null) {
    if ('type' in error) errorType = error.type;
    if ('status' in error) errorStatus = error.status;
  }

  let status = 500;
  let code: 'invalid_request' | 'internal_error' = 'internal_error';
  let message = 'The request could not be completed.';

  if (errorType === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_request';
    message = 'The request body must be valid JSON.';
  } else if (errorType === 'entity.too.large') {
    status = 413;
    code = 'invalid_request';
    message = 'The request body exceeds the 4 MB limit.';
  } else if (errorType === 'charset.unsupported') {
    status = 415;
    code = 'invalid_request';
    message = 'The request body charset is not supported.';
  } else if (errorType === 'encoding.unsupported') {
    status = 415;
    code = 'invalid_request';
    message = 'The request body encoding is not supported.';
  } else if (errorStatus === 400) {
    // Decompression failures can have a 400 status without an error type.
    status = 400;
    code = 'invalid_request';
    message = 'The request body is invalid.';
  }

  response.status(status).json({
    type: 'error',
    code,
    message,
  } satisfies ChatStreamEvent);
};
