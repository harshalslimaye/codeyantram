import {MAX_CONTENT_CHARACTERS, MAX_OUTPUT_BYTES} from './limits.js';
import type {Selection} from './selection.js';
import type {TransportDocument, WebFetchOutput, WebFormat} from './types.js';

const BISECTION_DIVISOR = 2;

const BEGIN = '[BEGIN_UNTRUSTED_WEB_CONTENT]';
const END = '[END_UNTRUSTED_WEB_CONTENT]';
const neutralize = (text: string) => text.replace(/\[(BEGIN|END)_UNTRUSTED_WEB_CONTENT\]/g, '[ESCAPED_$1_UNTRUSTED_WEB_CONTENT]');

export function formatOutput(document: TransportDocument, format: WebFormat, originalCharacters: number, selection: Selection): WebFetchOutput {
  const source = neutralize(selection.content);
  const output: WebFetchOutput = {
    requestedUrl: document.requestedUrl, finalUrl: document.finalUrl, status: document.status, contentType: document.contentType,
    format, content: '', untrusted: true, warnings: [...selection.warnings],
    truncation: {truncated: false, originalCharacters, selectedCharacters: selection.content.length, returnedCharacters: 0},
    filtering: selection.filtering,
  };
  const setContent = (characters: number) => {
    let returnedCharacters = characters;
    if (/[\uD800-\uDBFF]/.test(source[returnedCharacters - 1] ?? '') && /[\uDC00-\uDFFF]/.test(source[returnedCharacters] ?? '')) returnedCharacters--; // oxlint-disable-line security/detect-object-injection -- The index is a bounded character offset in the selected text.
    output.truncation.returnedCharacters = returnedCharacters;
    output.truncation.truncated = returnedCharacters < source.length;
    output.content = `${BEGIN}\n${source.slice(0, returnedCharacters)}\n${END}${output.truncation.truncated ? '\n[Output truncated by the host; additional source content exists.]' : ''}`;
  };
  setContent(Math.min(source.length, MAX_CONTENT_CHARACTERS));
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_OUTPUT_BYTES) {
    let low = 0; let high = output.truncation.returnedCharacters;
    while (low < high) {
      const mid = Math.ceil((low + high) / BISECTION_DIVISOR);
      setContent(mid);
      if (Buffer.byteLength(JSON.stringify(output), 'utf8') <= MAX_OUTPUT_BYTES) low = mid;
      else high = mid - 1;
    }
    setContent(low);
  }
  return output;
}
