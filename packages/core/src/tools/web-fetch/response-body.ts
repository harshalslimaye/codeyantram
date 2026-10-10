import {Transform, Writable, type Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';
import {WebFetchError} from './errors.js';
import {MAX_RESPONSE_BYTES} from './limits.js';

export async function readBody(body: Readable, headers: Record<string, string>, signal: AbortSignal): Promise<Buffer> {
  try {
    const length = headers['content-length'];
    if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
      throw new WebFetchError('source_too_large', 'The response exceeds the 5 MiB wire limit.');
    }
    const encoding = (headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    let decoder: Transform | undefined;
    if (encoding === 'gzip') decoder = createGunzip();
    else if (encoding === 'deflate') decoder = createInflate();
    else if (encoding === 'br') decoder = createBrotliDecompress();
    if (!decoder && encoding !== 'identity') throw new WebFetchError('unsupported_content', 'Unsupported response compression.');
    let wireBytes = 0;
    const wireLimit = new Transform({transform(chunk: Buffer, _encoding, callback) {
      wireBytes += chunk.length;
      callback(wireBytes > MAX_RESPONSE_BYTES ? new WebFetchError('source_too_large', 'The response exceeds the 5 MiB wire limit.') : null, chunk);
    }});
    let decodedBytes = 0;
    const chunks: Buffer[] = [];
    const sink = new Writable({write(chunk: Buffer, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > MAX_RESPONSE_BYTES) return callback(new WebFetchError('source_too_large', 'The decoded response exceeds 5 MiB.'));
      chunks.push(chunk); callback();
    }});
    await pipeline(decoder ? [body, wireLimit, decoder, sink] : [body, wireLimit, sink], {signal});
    return Buffer.concat(chunks, decodedBytes);
  } finally { body.destroy(); }
}
