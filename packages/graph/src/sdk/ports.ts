import type {CodeGraph} from '@colbymchenry/codegraph';

// Structural ports keep each operation dependent on the SDK capabilities it uses.
export type LifecycleBackend = Pick<CodeGraph, 'isIndexing' | 'reopenIfReplaced' | 'dropReadCaches' | 'close'>;
export type IndexBackend = Pick<CodeGraph, 'indexAll' | 'sync' | 'getIndexState' | 'getStats' | 'isIndexStale' | 'getLastIndexedAt'>;
export type LookupBackend = Pick<CodeGraph, 'searchNodes' | 'getNode' | 'getCode' | 'getCallers' | 'getCallees'>;
export type SourceBackend = Pick<CodeGraph, 'getFile'>;
export type ReferenceBackend = Pick<CodeGraph, 'getNode'>;
export type ExploreBackend = Pick<CodeGraph, 'buildContext' | 'getCode'>;
export type FindBackend = Pick<CodeGraph, 'searchNodes'>;
export type InspectBackend = Pick<CodeGraph, 'getFile' | 'getNodesInFile' | 'getCode'>;
export type TraceBackend = Pick<CodeGraph, 'traverse'>;
export type WorkspaceBackend = LifecycleBackend & IndexBackend & LookupBackend & SourceBackend
  & ExploreBackend & InspectBackend & TraceBackend;
