import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import type {SymbolReference} from '@codeyantram/shared';
import type {GraphSymbol} from '../contracts/graph.js';
import type {GraphNavigationSymbol} from '../contracts/navigation.js';

const MAX_SYMBOL_NAME_CHARACTERS = 256;
const MAX_SYMBOL_DETAIL_CHARACTERS = 512;
const MAX_DOCSTRING_CHARACTERS = 1024;

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
    id: node.id, kind: node.kind, name: node.name.slice(0, MAX_SYMBOL_NAME_CHARACTERS), qualifiedName: node.qualifiedName.slice(0, MAX_SYMBOL_DETAIL_CHARACTERS),
    filePath: node.filePath, language: node.language, startLine: node.startLine, endLine: node.endLine,
    ...(node.signature === undefined ? {} : {signature: node.signature.slice(0, MAX_SYMBOL_DETAIL_CHARACTERS)}),
    ...(node.docstring === undefined ? {} : {docstring: node.docstring.slice(0, MAX_DOCSTRING_CHARACTERS)}),
    metadataTruncated: node.name.length > MAX_SYMBOL_NAME_CHARACTERS || node.qualifiedName.length > MAX_SYMBOL_DETAIL_CHARACTERS
      || (node.signature?.length ?? 0) > MAX_SYMBOL_DETAIL_CHARACTERS || (node.docstring?.length ?? 0) > MAX_DOCSTRING_CHARACTERS,
    reference,
  };
}
