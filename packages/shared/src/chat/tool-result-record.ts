import {Buffer} from 'node:buffer';
import {z} from 'zod';
import type {ToolOutput, ToolResult} from '../tools/types.js';
import {graphRecordEvidence} from './tool-result-graph-record.js';

export const MIN_TRIM_RESULT_BYTES = 8_192;
export const MAX_TRIM_RECORD_BYTES = 2_048;
const MAX_EXCERPT_CHARACTERS = 256;
const MAX_EXCERPTS = 3;
const REDUCTION_FACTOR = 2;
const count = z.number().int().nonnegative();
const warnings = z.array(z.string());
const filtering = z.object({status: z.enum(['skipped', 'completed', 'partial', 'failed']), incomplete: z.boolean()}).loose();
const source = {untrusted: z.literal(true), warnings, filtering};
const search = {coverage: z.string(), truncated: z.boolean(), incomplete: z.boolean()};
const readSchema = z.object({...source, filePath: z.string(), contentHash: z.string(), totalLines: count,
  offset: count, nextOffset: count.nullable(), ranges: z.array(z.object({startLine: count, endLine: count, text: z.string()}).loose()),
  truncation: z.object({truncated: z.boolean(), lineTruncated: z.boolean()}).loose()}).loose();
const grepSchema = z.object({...source, ...search, pattern: z.string(), path: z.string(),
  matches: z.array(z.object({filePath: z.string(), line: count, column: count, text: z.string(),
    textStartColumn: count, textTruncated: z.boolean()}).loose())}).loose();
const globSchema = z.object({...source, ...search, pattern: z.string(), path: z.string(), files: z.array(z.string())}).loose();
const gitSchema = z.object({...source, ...search, entries: z.array(z.string()), summary: z.string().optional()}).loose();
const webSchema = z.object({...source, requestedUrl: z.string(), finalUrl: z.string(), status: count,
  contentType: z.string(), format: z.enum(['markdown', 'text', 'html']), content: z.string(),
  truncation: z.object({truncated: z.boolean(), originalCharacters: count, selectedCharacters: count, returnedCharacters: count}).loose()}).loose();
const bashSchema = z.object({untrusted: z.literal(true), warnings, workdir: z.string(), stdout: z.string(), stderr: z.string(),
  exitCode: z.number().int().nullable(), signal: z.string().nullable(), termination: z.enum(['exit', 'timeout', 'output_limit']),
  durationMs: z.number().nonnegative(), truncated: z.boolean()}).loose();
const recoverySchema = z.object({toolCallId: z.string(), contentHash: z.string(), offset: count, nextOffset: count.nullable(),
  totalCharacters: count, originalBytes: count, content: z.string(), untrusted: z.literal(true), coverage: z.string()}).loose();

interface RecordEvidence {facts: unknown; excerpts: string[]}

/** Verbatim head/tail excerpts; no invented semantic findings or test outcomes. */
function excerpt(text: string): string {
  if (text.length <= MAX_EXCERPT_CHARACTERS) return text;
  const half = MAX_EXCERPT_CHARACTERS / REDUCTION_FACTOR;
  return `${text.slice(0, half)}\n[excerpt omitted]\n${text.slice(-half)}`;
}

function readEvidence(output: ToolOutput): RecordEvidence | undefined {
  const parsed = readSchema.safeParse(output);
  if (!parsed.success) return;
  const {ranges, ...metadata} = parsed.data;
  return {facts: {...metadata, ranges: ranges.map(({text: _text, ...range}) => range)},
    excerpts: ranges.slice(0, MAX_EXCERPTS).map(range => `${range.startLine}-${range.endLine}: ${excerpt(range.text)}`)};
}

function grepEvidence(output: ToolOutput): RecordEvidence | undefined {
  const parsed = grepSchema.safeParse(output);
  if (!parsed.success) return;
  const {matches, ...metadata} = parsed.data;
  return {facts: {...metadata, returnedMatches: matches.length,
    matches: matches.slice(0, MAX_EXCERPTS).map(({text: _text, ...match}) => match)},
    excerpts: matches.slice(0, MAX_EXCERPTS).map(match => `${match.filePath}:${match.line}:${match.column}: ${excerpt(match.text)}`)};
}

function listEvidence(name: string, output: ToolOutput): RecordEvidence | undefined {
  if (name === 'glob') {
    const parsed = globSchema.safeParse(output);
    if (!parsed.success) return;
    const {files, ...metadata} = parsed.data;
    return {facts: {...metadata, returnedPaths: files.length, files: files.slice(0, MAX_EXCERPTS)}, excerpts: []};
  }
  const parsed = gitSchema.safeParse(output);
  if (!parsed.success) return;
  const {entries, ...metadata} = parsed.data;
  return {facts: {...metadata, returnedEntries: entries.length}, excerpts: entries.slice(0, MAX_EXCERPTS).map(excerpt)};
}

function textEvidence(name: string, output: ToolOutput): RecordEvidence | undefined {
  if (name === 'web_fetch') {
    const parsed = webSchema.safeParse(output);
    if (!parsed.success) return;
    const {content, ...metadata} = parsed.data;
    return {facts: metadata, excerpts: [excerpt(content)]};
  }
  const parsed = bashSchema.safeParse(output);
  if (!parsed.success) return;
  const {stdout, stderr, ...metadata} = parsed.data;
  return {facts: metadata, excerpts: [`stdout: ${excerpt(stdout)}`, `stderr: ${excerpt(stderr)}`]};
}

function recoveryEvidence(output: ToolOutput): RecordEvidence | undefined {
  const parsed = recoverySchema.safeParse(output);
  if (!parsed.success) return;
  const {content, ...metadata} = parsed.data;
  return {facts: metadata, excerpts: [excerpt(content)]};
}

const evidenceBuilders = new Map<string, (output: ToolOutput) => RecordEvidence | undefined>([
  ['read', readEvidence], ['grep', grepEvidence], ['tool_result_read', recoveryEvidence],
  ...['glob', 'git_status', 'git_diff', 'git_log', 'git_show'].map(name =>
    [name, (output: ToolOutput) => listEvidence(name, output)] as const),
  ...['bash', 'web_fetch'].map(name => [name, (output: ToolOutput) => textEvidence(name, output)] as const),
  ...['explore', 'find', 'inspect', 'trace'].map(name => [name, (output: ToolOutput) => graphRecordEvidence(name, output)] as const),
]);

export function serializedToolResultBytes(result: ToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

/** Only known, validated large successes can be replaced. Mandatory facts never truncate. */
export function trimToolResult(result: ToolResult): ToolResult {
  if (result.status !== 'success') return result;
  const originalBytes = serializedToolResultBytes(result);
  if (originalBytes < MIN_TRIM_RESULT_BYTES) return result;
  const selected = evidenceBuilders.get(result.toolName)?.(result.output);
  if (selected === undefined) return result;
  // Zod's loose metadata remains original JSON; normalize into the shared JSON type.
  const facts = z.json().parse(selected.facts);
  const record = {kind: 'older-tool-result', version: 1, untrusted: true, originalBytes,
    omitted: true, note: 'Historical output with omissions. Excerpts are verbatim, not exhaustive findings. Source limitations remain in facts.',
    recovery: {toolName: 'tool_result_read', toolCallId: result.toolCallId}, facts, excerpts: selected.excerpts};
  const candidate = {...result, output: record};
  if (serializedToolResultBytes(candidate) <= MAX_TRIM_RECORD_BYTES
    && serializedToolResultBytes(candidate) * REDUCTION_FACTOR <= originalBytes) return candidate;
  const withoutExcerpts = {...candidate, output: {...record, excerpts: []}};
  if (serializedToolResultBytes(withoutExcerpts) <= MAX_TRIM_RECORD_BYTES
    && serializedToolResultBytes(withoutExcerpts) * REDUCTION_FACTOR <= originalBytes) return withoutExcerpts;
  return result;
}
