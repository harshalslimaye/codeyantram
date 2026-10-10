import type {ErrorRequestHandler} from 'express';
import type {ChatStreamEvent} from '@codeyantram/shared';

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const {errorType, errorStatus} = errorMetadata(error);

  let status = HTTP_INTERNAL_SERVER_ERROR;
  let code: 'invalid_request' | 'internal_error' = 'internal_error';
  let message = 'The request could not be completed.';

  if (errorType === 'entity.parse.failed') {
    status = HTTP_BAD_REQUEST;
    code = 'invalid_request';
    message = 'The request body must be valid JSON.';
  } else if (errorType === 'entity.too.large') {
    status = HTTP_PAYLOAD_TOO_LARGE;
    code = 'invalid_request';
    message = 'The request body exceeds the 4 MB limit.';
  } else if (errorType === 'charset.unsupported') {
    status = HTTP_UNSUPPORTED_MEDIA_TYPE;
    code = 'invalid_request';
    message = 'The request body charset is not supported.';
  } else if (errorType === 'encoding.unsupported') {
    status = HTTP_UNSUPPORTED_MEDIA_TYPE;
    code = 'invalid_request';
    message = 'The request body encoding is not supported.';
  } else if (errorStatus === HTTP_BAD_REQUEST) {
    // Decompression failures can have a 400 status without an error type.
    status = HTTP_BAD_REQUEST;
    code = 'invalid_request';
    message = 'The request body is invalid.';
  }

  response.status(status).json({
    type: 'error',
    code,
    message,
  } satisfies ChatStreamEvent);
};

function errorMetadata(error: unknown) {
  let errorType: unknown;
  let errorStatus: unknown;
  if (typeof error === 'object' && error !== null) {
    if ('type' in error) errorType = error.type;
    if ('status' in error) errorStatus = error.status;
  }

  return {errorType, errorStatus};
}
