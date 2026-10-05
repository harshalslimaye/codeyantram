import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import type {SymbolReference} from '@codeyantram/shared';
import type {GraphSymbol} from '../contracts/graph.js';
import type {GraphNavigationSymbol} from '../contracts/navigation.js';

export function toSymbol(node: CodeGraphNode): GraphSymbol {
  return {
    id: node.id, kind: node.kind, name: node.name, qualifiedName: node.qualifiedName,
    filePath: node.filePath, language: node.language, startLine: node.startLine, endLine: node.endLine,
    ...(node.signature === undefined ? {} : {signature: node.signature}),
    ...(node.docstring === undefined ? {} : {docstring: node.docstring}),
  };
}

export function toNavigationSymbol(node: CodeGraphNode, reference: SymbolReference): GraphNavigationSymbol {
  return {
    id: node.id, kind: node.kind, name: node.name.slice(0, 256), qualifiedName: node.qualifiedName.slice(0, 512),
    filePath: node.filePath, language: node.language, startLine: node.startLine, endLine: node.endLine,
    ...(node.signature === undefined ? {} : {signature: node.signature.slice(0, 512)}),
    ...(node.docstring === undefined ? {} : {docstring: node.docstring.slice(0, 1024)}),
    metadataTruncated: node.name.length > 256 || node.qualifiedName.length > 512
      || (node.signature?.length ?? 0) > 512 || (node.docstring?.length ?? 0) > 1024,
    reference,
  };
}
