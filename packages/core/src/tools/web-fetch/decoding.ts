import {WebFetchError} from './errors.js';

export function classifyContent(contentType: string): 'html' | 'text' {
  const mime = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (['text/plain', 'text/markdown', 'text/x-markdown', 'text/xml', 'application/json', 'application/xml'].includes(mime)
    || /^application\/[a-z0-9!#$&^_.+-]+\+(json|xml)$/.test(mime)) return 'text';
  throw new WebFetchError('unsupported_content', 'The response is not a supported HTML, Markdown, text, JSON, or XML document.');
}

export function decodeText(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  let decoder: TextDecoder | undefined;
  if (declared) { try { decoder = new TextDecoder(declared); } catch { /* Fall back to BOM or UTF-8. */ } }
  if (!decoder) {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    decoder = new TextDecoder(encoding);
  }
  const text = decoder.decode(bytes);
  const controls = text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)?.length ?? 0;
  if (text.includes('\0') || controls > Math.max(2, text.length / 100)) {
    throw new WebFetchError('unsupported_content', 'The response contains binary data rather than supported text.');
  }
  return text;
}
