import {z} from 'zod';
import {navigationFilePathSchema} from '@codeyantram/shared';
import {sep} from 'node:path';
import {MAX_MATCH_CHARACTERS} from './limits.js';
import type {GrepMatch} from './types.js';

const messageSchema = z.object({type: z.string(), data: z.unknown()});
const EXCERPT_CENTER_DIVISOR = 2;
const matchSchema = z.object({
  path: z.object({text: z.string()}), lines: z.object({text: z.string()}),
  line_number: z.number().int().min(1),
  submatches: z.array(z.object({start: z.number().int().min(0)})).min(1),
});

export function parseMatch(json: string): GrepMatch | null | 'unsupported' {
  const message = messageSchema.parse(JSON.parse(json) as unknown);
  if (message.type !== 'match') return null;
  const parsed = matchSchema.safeParse(message.data);
  if (!parsed.success) return 'unsupported';
  const data = parsed.data;
  const portablePath = sep === '\\' ? data.path.text.replaceAll('\\', '/') : data.path.text;
  const filePath = portablePath.replace(/^\.\//, '');
  if (!navigationFilePathSchema.safeParse(filePath).success) return 'unsupported';
  const column = (data.submatches.at(0)?.start ?? 0) + 1;
  const original = data.lines.text.replace(/\r?\n$/, '');
  const characterOffset = Buffer.from(original).subarray(0, column - 1).toString('utf8').length;
  let start = Math.max(0, characterOffset - Math.floor(MAX_MATCH_CHARACTERS / EXCERPT_CENTER_DIVISOR));
  if (/[\uDC00-\uDFFF]/.test(original.charAt(start))) start++;
  let text = original.slice(start, start + MAX_MATCH_CHARACTERS);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return {filePath, line: data.line_number, column, text,
    textStartColumn: Buffer.byteLength(original.slice(0, start), 'utf8') + 1,
    textTruncated: start > 0 || start + text.length < original.length};
}
