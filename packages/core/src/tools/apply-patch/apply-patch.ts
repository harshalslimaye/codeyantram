import {tool} from 'ai';
import type {ToolExecutor} from '../types.js';
import {applyPatchInputSchema} from './schema.js';
import type {ApplyPatchService} from './types.js';

export function createApplyPatchTool(service: ApplyPatchService, execute: ToolExecutor, objective?: string) {
  return tool({
    description: 'Apply an exact-context workspace text patch after host approval. patchText uses *** Begin Patch, *** Add/Update/Delete File: relative/path, @@ hunks, and *** End Patch. Add lines start +; update lines start space, +, or -. Moves, fuzzy matching, symlinks, protected metadata, and missing parent directories are unsupported. Read with filter:false first, and supply expectedHashes for every updated/deleted file, none for additions. Multi-file writes are not transactional. Re-read all targets after interruption or partial failure; never blindly replay. Run tests separately.',
    inputSchema: applyPatchInputSchema,
    execute: (input, options) => execute('apply_patch', options.toolCallId, options.abortSignal,
      () => service.apply(input, {abortSignal: options.abortSignal, objective})),
  });
}
