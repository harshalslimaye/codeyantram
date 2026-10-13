import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {tool, type ModelMessage} from 'ai';
import {z} from 'zod';
import {asObject, toolResultSchema, type ToolResult} from '@codeyantram/shared';
import type {ToolExecutor} from '../tools/types.js';
import {ReadError} from '../tools/read/errors.js';

const DEFAULT_PAGE_CHARACTERS = 8_192;
const MAX_PAGE_CHARACTERS = 24_576;
const MAX_PAGE_BYTES = 24_576;
const PAGE_TARGET_BYTES = 8_192;
const SURROGATE_LOW_START = 0xdc00;
const SURROGATE_LOW_END = 0xdfff;
const HALVE = 2;

interface ArchivedResult {
  text: string;
  contentHash: string;
  originalStatus: ToolResult['status'];
  sourceLimitations: {truncated: boolean | null; lineTruncated: boolean | null;
    incomplete: boolean | null; filteringIncomplete: boolean | null};
}

function booleanOrUnknown(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function sourceLimitations(result: ToolResult): ArchivedResult['sourceLimitations'] {
  const output = asObject(result.status === 'success' ? result.output : {});
  const truncation = asObject(output.truncation);
  return {truncated: booleanOrUnknown(output.truncated) ?? booleanOrUnknown(truncation.truncated),
    lineTruncated: booleanOrUnknown(truncation.lineTruncated), incomplete: booleanOrUnknown(output.incomplete),
    filteringIncomplete: booleanOrUnknown(asObject(output.filtering).incomplete)};
}

export const toolResultReadInputSchema = z.strictObject({
  toolCallId: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().min(1).max(MAX_PAGE_CHARACTERS).optional(),
});

export function resultFromModelPart(part: {toolCallId: string; toolName: string; output: unknown}): ToolResult | undefined {
  const output = z.object({type: z.literal('json'), value: z.unknown()}).safeParse(part.output);
  if (!output.success) return;
  const parsed = toolResultSchema.safeParse(output.data.value);
  if (parsed.success && parsed.data.toolCallId === part.toolCallId && parsed.data.toolName === part.toolName) return parsed.data;
  return;
}

/** A request-local snapshot of returned output. It never invokes the original tool. */
export class ToolResultArchive {
  private entries = new Map<string, ArchivedResult>();
  private ambiguousIds = new Set<string>();
  private recoveryCalls = 0;
  private recoveryBytes = 0;

  isAmbiguous(toolCallId: string): boolean {return this.ambiguousIds.has(toolCallId);}

  diagnostics() {return {recoveryCalls: this.recoveryCalls, recoveryBytes: this.recoveryBytes};}

  record(messages: readonly ModelMessage[]): void {
    for (const message of messages) {
      if (message.role !== 'tool') continue;
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        const result = resultFromModelPart(part);
        if (result === undefined) continue;
        const text = JSON.stringify(result);
        const previous = this.entries.get(result.toolCallId);
        // Providers may reuse short call IDs; an ID with conflicting output is ambiguous, so it is never trimmed or recovered.
        if (previous !== undefined && previous.text !== text) this.ambiguousIds.add(result.toolCallId);
        if (previous === undefined) this.entries.set(result.toolCallId, {text, contentHash: createHash('sha256').update(text).digest('hex'),
          originalStatus: result.status, sourceLimitations: sourceLimitations(result)});
      }
    }
  }

  read(input: z.infer<typeof toolResultReadInputSchema>) {
    this.recoveryCalls++;
    const entry = this.ambiguousIds.has(input.toolCallId) ? undefined : this.entries.get(input.toolCallId);
    if (entry === undefined) throw new ReadError('not_found', 'This tool result is unavailable in the active conversation. It may have been removed by manual compaction.');
    const offset = input.offset ?? 0;
    if (offset >= entry.text.length || isLowSurrogate(entry.text, offset)) {
      throw new ReadError('invalid_input', 'Use an offset within the historical JSON text at a Unicode character boundary.');
    }
    const page = boundedPage(entry, input, offset);
    this.recoveryBytes += Buffer.byteLength(JSON.stringify(page), 'utf8');
    return page;
  }

  createTool(execute: ToolExecutor) {
    return tool({
      description: 'Recover exact original historical tool output by toolCallId without repeating its operation. Returns a bounded page of serialized result JSON. Offsets/length use UTF-16 characters; follow nextOffset. Available only for results in this active conversation. Historical source may already have been filtered/truncated and does not establish current file state.',
      inputSchema: toolResultReadInputSchema,
      execute: (input, options) => execute('tool_result_read', options.toolCallId, options.abortSignal, async () => this.read(input)),
    });
  }
}

function boundedPage(entry: ArchivedResult, input: z.infer<typeof toolResultReadInputSchema>, offset: number) {
  const byteLimit = input.length === undefined ? PAGE_TARGET_BYTES : MAX_PAGE_BYTES;
  let end = Math.min(entry.text.length, offset + (input.length ?? DEFAULT_PAGE_CHARACTERS));
  // A tiny requested length still returns a complete Unicode character.
  if (isLowSurrogate(entry.text, end)) end++;
  let page = recoveryPage(entry, input.toolCallId, offset, end);
  while (Buffer.byteLength(JSON.stringify(page), 'utf8') > byteLimit && end > offset + 1) {
    end = offset + Math.floor((end - offset) / HALVE);
    if (isLowSurrogate(entry.text, end)) end++;
    page = recoveryPage(entry, input.toolCallId, offset, end);
    if (end === offset + HALVE) break;
  }
  if (Buffer.byteLength(JSON.stringify(page), 'utf8') > MAX_PAGE_BYTES) {
    throw new ReadError('source_too_large', 'Historical result metadata exceeds the recovery page limit.');
  }
  return page;
}

function isLowSurrogate(text: string, offset: number): boolean {
  const code = text.charCodeAt(offset);
  return code >= SURROGATE_LOW_START && code <= SURROGATE_LOW_END;
}

function recoveryPage(entry: ArchivedResult, toolCallId: string, offset: number, end: number) {
  return {toolCallId, contentHash: entry.contentHash, offset, nextOffset: end < entry.text.length ? end : null,
    totalCharacters: entry.text.length, originalBytes: Buffer.byteLength(entry.text, 'utf8'),
    content: entry.text.slice(offset, end), untrusted: true, originalStatus: entry.originalStatus, sourceLimitations: entry.sourceLimitations,
    coverage: 'Exact page of historical returned JSON; original filtering, truncation, warnings and errors remain in that JSON. No source was re-read.'};
}
