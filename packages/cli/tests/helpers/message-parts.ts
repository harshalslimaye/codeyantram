import type {MessagePart, TextPart} from '@codeyantram/shared';

/** Existing text fixtures should fail explicitly if a non-text part appears. */
export function requireTextPart(part: MessagePart): TextPart {
  if (part.type !== 'text') throw new Error('Expected a text fixture part.');
  return part;
}
