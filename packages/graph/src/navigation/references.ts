import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import {symbolReferenceSchema, type SymbolReference} from '@codeyantram/shared';
import type {GraphNavigationSymbol} from '../contracts/navigation.js';
import type {ReferenceBackend} from '../sdk/ports.js';
import type {SourceFingerprints, SymbolReferenceFactory, VerifiedSymbols, SymbolResolver} from './ports.js';
import {GraphNavigationError} from './errors.js';
import {toNavigationSymbol} from './symbols.js';

/** Creates and validates references bound to a workspace and exact file content. */
export class SymbolReferences implements SymbolReferenceFactory, VerifiedSymbols, SymbolResolver {
  constructor(private readonly backend: ReferenceBackend, private readonly sources: SourceFingerprints,
    private readonly workspaceId: string) {}

  reference(node: Pick<CodeGraphNode, 'id' | 'filePath'>, contentHash: string): SymbolReference {
    return {workspaceId: this.workspaceId, symbolId: node.id, filePath: node.filePath, contentHash};
  }

  async verified(node: CodeGraphNode, hashes: Map<string, string>): Promise<GraphNavigationSymbol> {
    const hash = hashes.get(node.filePath) ?? await this.sources.fingerprint(node.filePath);
    hashes.set(node.filePath, hash);
    return toNavigationSymbol(node, this.reference(node, hash));
  }

  async resolve(reference: SymbolReference): Promise<GraphNavigationSymbol> {
    if (!symbolReferenceSchema.safeParse(reference).success) throw new GraphNavigationError('invalid_input', 'A complete symbol reference from find or explore is required.');
    if (reference.workspaceId !== this.workspaceId) throw new GraphNavigationError('stale_reference', 'This reference belongs to another workspace. Run find or explore again.');
    const node = this.backend.getNode(reference.symbolId);
    if (!node || node.filePath !== reference.filePath) throw new GraphNavigationError('stale_reference', 'The symbol was removed or moved. Run find or explore again.');
    const hash = await this.sources.fingerprint(node.filePath);
    if (hash !== reference.contentHash) throw new GraphNavigationError('stale_reference', 'The referenced file changed. Run find or explore again.');
    return toNavigationSymbol(node, this.reference(node, hash));
  }
}
