import type {SymbolReference} from '@codeyantram/shared';
import type {GraphSymbol} from './graph.js';

export interface GraphNavigationSymbol extends GraphSymbol {reference: SymbolReference; metadataTruncated: boolean}
export interface GraphFindResult {
  query: string;
  matches: {symbol: GraphNavigationSymbol; score: number}[];
  truncated: boolean;
  coverage: string;
}
export type GraphInspectTarget = {reference: SymbolReference; filePath?: never} | {filePath: string; reference?: never};
export type GraphInspectResult = {
  type: 'symbol'; symbol: GraphNavigationSymbol;
  source: {text: string; startLine: number; endLine: number; contentHash: string; truncated: boolean};
  truncated: boolean; coverage: string;
} | {
  type: 'file'; filePath: string; contentHash: string;
  symbols: GraphNavigationSymbol[]; truncated: boolean; coverage: string;
};
export interface GraphTraceResult {
  target: GraphNavigationSymbol;
  direction: 'callers' | 'callees';
  depth: number;
  symbols: GraphNavigationSymbol[];
  relationships: {source: string; target: string; kind: string; line?: number; column?: number; metadata?: Record<string, unknown>}[];
  truncated: boolean;
  coverage: string;
}

export interface GraphExploreContext {
  query: string;
  summary: string;
  symbols: GraphNavigationSymbol[];
  relationships: {source: string; target: string; kind: string; metadata?: Record<string, unknown>}[];
  snippets: {symbolId: string; filePath: string; startLine: number; endLine: number; contentHash: string; text: string; truncated: boolean}[];
  relatedFiles: string[];
  truncated: boolean;
  coverage: string;
}

export interface GraphFindOptions {limit?: number; maxCharacters?: number}
export type GraphInspectOptions = GraphFindOptions;
export interface GraphTraceOptions extends GraphFindOptions {direction: 'callers' | 'callees'; depth?: number}
export interface GraphExploreOptions {maxNodes?: number; maxCharacters?: number}
