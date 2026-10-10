export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;
export const MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 5_242_880;
export const MAX_CONTENT_CHARACTERS = 24_000;
export const MAX_OUTPUT_BYTES = 60_000;
export const MAX_URL_CHARACTERS = 4096;
export const MAX_HTML_ELEMENTS = 50_000;
export const MAX_HTML_DEPTH = 128;
export const MAX_CHUNK_CHARACTERS = 2400;
export const MAX_CHUNKS = 4096;
export const MIN_FILTER_CHARACTERS = 6000;
export const MAX_EVALUATED_CHUNKS = 32;
export const EVALUATION_BATCH_SIZE = 8;
export const EVALUATION_CONCURRENCY = 2;
export const FILTER_TIMEOUT_MS = 5000;
/** Provisional conservative cutoff; live evidence-retention evaluation is documented separately. */
export const IRRELEVANT_PROBABILITY = 0.05;
