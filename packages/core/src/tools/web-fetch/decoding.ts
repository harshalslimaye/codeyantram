import {WebFetchError} from './errors.js';

const MIN_CONTROL_CHARACTER_THRESHOLD = 2;

const BOM_BYTE_FF = 0xff;
const BOM_BYTE_FE = 0xfe;
const MAX_CONTROL_CHARACTER_RATIO_DENOMINATOR = 100;

export function classifyContent(contentType: string): 'html' | 'text' {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (['text/plain', 'text/markdown', 'text/x-markdown', 'text/xml', 'application/json', 'application/xml'].includes(mime)
    || /^application\/[a-z0-9!#$&^_.+-]+\+(json|xml)$/.test(mime)) return 'text';
  throw new WebFetchError('unsupported_content', 'The response is not a supported HTML, Markdown, text, JSON, or XML document.');
}

export function decodeText(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  let decoder: TextDecoder | undefined;
  if (declared !== undefined && declared !== '') { try { decoder = new TextDecoder(declared); } catch { /* Fall back to BOM or UTF-8. */ } }
  if (!decoder) {
    let encoding = 'utf-8';
    if (bytes[0] === BOM_BYTE_FF && bytes[1] === BOM_BYTE_FE) encoding = 'utf-16le';
    else if (bytes[0] === BOM_BYTE_FE && bytes[1] === BOM_BYTE_FF) encoding = 'utf-16be';
    decoder = new TextDecoder(encoding);
  }
  const text = decoder.decode(bytes);
  // oxlint-disable-next-line no-control-regex -- Count binary control characters before accepting decoded text.
  const controls = text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)?.length ?? 0;
  if (text.includes('\0') || controls > Math.max(MIN_CONTROL_CHARACTER_THRESHOLD, text.length / MAX_CONTROL_CHARACTER_RATIO_DENOMINATOR)) {
    throw new WebFetchError('unsupported_content', 'The response contains binary data rather than supported text.');
  }
  return text;
}
