import {z} from 'zod';
import {symbolReferenceSchema} from '../tools/navigation.js';
import type {ToolOutput} from '../tools/types.js';

const MAX_FINDINGS = 1;
const MAX_SOURCE_EXCERPT = 256;
const symbol = z.object({id: z.string(), name: z.string(), qualifiedName: z.string(), kind: z.string(),
  filePath: z.string(), startLine: z.number().int(), endLine: z.number().int(), reference: symbolReferenceSchema,
  metadataTruncated: z.boolean()}).loose();
const relationship = z.object({source: z.string(), target: z.string(), kind: z.string()}).loose();
const coverage = {coverage: z.string(), truncated: z.boolean()};
const snippet = z.object({filePath: z.string(), startLine: z.number().int(), endLine: z.number().int(),
  contentHash: z.string(), text: z.string(), truncated: z.boolean()}).loose();
const schemas = new Map<string, z.ZodType>([
  ['explore', z.object({...coverage, query: z.string(), summary: z.string(), symbols: z.array(symbol),
    relationships: z.array(relationship), snippets: z.array(snippet), relatedFiles: z.array(z.string())}).loose()],
  ['find', z.object({...coverage, query: z.string(), matches: z.array(z.object({symbol, score: z.number()}).loose())}).loose()],
  ['trace', z.object({...coverage, target: symbol, direction: z.enum(['callers', 'callees']), depth: z.number().int(),
    symbols: z.array(symbol), relationships: z.array(relationship)}).loose()],
  ['inspect', z.discriminatedUnion('type', [
    z.object({...coverage, type: z.literal('symbol'), symbol,
      source: z.object({text: z.string(), startLine: z.number().int(), endLine: z.number().int(), contentHash: z.string(), truncated: z.boolean()}).loose()}).loose(),
    z.object({...coverage, type: z.literal('file'), filePath: z.string(), contentHash: z.string(), symbols: z.array(symbol)}).loose(),
  ])],
]);
const bulkFields = new Map<string, string[]>([
  ['explore', ['symbols', 'relationships', 'relatedFiles', 'snippets']],
  ['find', ['matches']], ['trace', ['symbols', 'relationships']], ['inspect', ['symbols']],
]);

/** Keep graph coverage/freshness and exact reference candidates, with original coordinates. */
export function graphRecordEvidence(name: string, output: ToolOutput): {facts: unknown; excerpts: string[]} | undefined {
  const schema = schemas.get(name);
  if (schema === undefined) return;
  const wrapper = z.object({context: schema, freshness: z.record(z.string(), z.json())}).loose().safeParse(output);
  if (!wrapper.success) return;
  const context = z.record(z.string(), z.json()).parse(wrapper.data.context);
  const facts = {...context};
  const excerpts: string[] = [];
  const symbolInspection = name === 'inspect' && context.type === 'symbol';
  const fields = symbolInspection ? [] : bulkFields.get(name) ?? [];
  for (const field of fields) {
    const items = Reflect.get(facts, field) as unknown;
    if (!Array.isArray(items)) continue;
    Reflect.set(facts, `returned${field[0].toUpperCase()}${field.slice(1)}`, items.length);
    const selected: unknown[] = items.slice(0, MAX_FINDINGS);
    if (field === 'snippets') {
      Reflect.set(facts, field, selected.map(item => sourceCoordinates(item, excerpts)));
    } else Reflect.set(facts, field, selected);
  }
  if (symbolInspection) facts.source = z.json().parse(sourceCoordinates(facts.source, excerpts));
  return {facts: {...wrapper.data, context: facts}, excerpts};
}

function sourceCoordinates(value: unknown, excerpts: string[]): unknown {
  const parsed = z.object({text: z.string(), startLine: z.number().int(), endLine: z.number().int()}).loose().parse(value);
  const {text, ...metadata} = parsed;
  excerpts.push(`${parsed.startLine}-${parsed.endLine}: ${text.slice(0, MAX_SOURCE_EXCERPT)}${text.length > MAX_SOURCE_EXCERPT ? '\n[excerpt omitted]' : ''}`);
  return metadata;
}
