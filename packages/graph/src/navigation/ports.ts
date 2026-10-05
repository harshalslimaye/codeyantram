import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import type {SymbolReference} from '@codeyantram/shared';
import type {GraphNavigationSymbol} from '../contracts/navigation.js';

export interface SourceFingerprints {
  fingerprint(filePath: string): Promise<string>;
  verifyFiles(hashes: ReadonlyMap<string, string>): Promise<void>;
}

export interface SymbolReferenceFactory {
  reference(node: Pick<CodeGraphNode, 'id' | 'filePath'>, contentHash: string): SymbolReference;
}

export interface VerifiedSymbols {
  verified(node: CodeGraphNode, hashes: Map<string, string>): Promise<GraphNavigationSymbol>;
}

export interface SymbolResolver {
  resolve(reference: SymbolReference): Promise<GraphNavigationSymbol>;
}
