import type {JevCapability} from '../../evaluation/index.js';
import {resolve} from 'node:path';
import {ReadError} from './errors.js';
import {readWorkspaceFile} from './filesystem.js';
import {readPage} from './page.js';
import {chunkLines} from './chunks.js';
import {readInputSchema} from './schema.js';
import {selectReadChunks} from './selection.js';
import type {ReadService} from './types.js';

export function createReadService(options: {workspaceRoot: string; jev?: JevCapability}): ReadService {
  if (!options.workspaceRoot.trim()) throw new ReadError('invalid_input', 'The host must provide a workspace root.');
  const workspaceRoot = resolve(options.workspaceRoot);
  const jev = options.jev;
  return {async read(input, context = {}) {
    context.abortSignal?.throwIfAborted();
    const parsed = readInputSchema.safeParse(input);
    if (!parsed.success) throw new ReadError('invalid_input', 'Provide a workspace-relative file path and valid read limits.');
    const args = parsed.data;
    const file = await readWorkspaceFile(workspaceRoot, args.filePath, context.abortSignal);
    const page = readPage(file.text, args);
    const selected = await selectReadChunks(chunkLines(page.lines), {jev, filePath: args.filePath,
      objective: args.query ?? context.objective, filter: args.filter, signal: context.abortSignal});
    const warnings = [...selected.warnings];
    if (page.truncation.lineTruncated) warnings.push('A source line was truncated by the read output budget.');
    return {filePath: args.filePath, contentHash: file.contentHash, totalLines: page.totalLines,
      offset: page.offset, nextOffset: page.nextOffset,
      ranges: selected.chunks.map(({startLine, endLine, text}) => ({startLine, endLine, text})),
      untrusted: true, truncation: page.truncation, filtering: selected.filtering, warnings};
  }};
}
