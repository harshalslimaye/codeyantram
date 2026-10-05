import type {Node as CodeGraphNode} from '@colbymchenry/codegraph';
import {describe, expect, it, vi} from 'vitest';
import {ExploreQuery} from '../../src/navigation/explore.js';
import {FindQuery} from '../../src/navigation/find.js';
import {InspectQuery} from '../../src/navigation/inspect.js';
import {GraphNavigationError, GraphSourceChangedError} from '../../src/navigation/errors.js';
import {SymbolReferences} from '../../src/navigation/references.js';
import type {SourceFingerprints} from '../../src/navigation/ports.js';

const workspaceId = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const node: CodeGraphNode = {
  id: 'greet-id', kind: 'function', name: 'greet', qualifiedName: 'src/helper.ts::greet',
  filePath: 'src/helper.ts', language: 'typescript', startLine: 1, endLine: 1,
  startColumn: 0, endColumn: 42, updatedAt: 1,
};

function verification() {
  const sources = {
    fingerprint: vi.fn<SourceFingerprints['fingerprint']>().mockResolvedValue(hash),
    verifyFiles: vi.fn<SourceFingerprints['verifyFiles']>().mockResolvedValue(undefined),
  };
  const backend = {getNode: vi.fn().mockReturnValue(node)};
  const references = new SymbolReferences(backend, sources, workspaceId);
  return {sources, backend, references, reference: references.reference(node, hash)};
}

describe('navigation through narrow ports without an SDK connection', () => {
  it('finds ambiguous candidates and verifies shared source once before its final check', async () => {
    const {sources, references} = verification();
    const other = {...node, id: 'another-id', qualifiedName: 'src/helper.ts::other.greet'};
    const find = new FindQuery({searchNodes: () => [{node, score: 1}, {node: other, score: 0.9}]}, sources, references);
    const result = await find.execute('greet');
    expect(result.matches.map(match => match.symbol.id)).toEqual([node.id, other.id]);
    expect(sources.fingerprint).toHaveBeenCalledOnce();
    expect(sources.verifyFiles).toHaveBeenCalledWith(new Map([[node.filePath, hash]]));
    expect(result.matches.every(match => match.symbol.reference.contentHash === hash)).toBe(true);
  });

  it('rejects a foreign reference before invoking symbol or source backends', async () => {
    const {sources, backend, references, reference} = verification();
    await expect(references.resolve({...reference, workspaceId: 'c'.repeat(64)}))
      .rejects.toMatchObject({code: 'stale_reference'});
    expect(backend.getNode).not.toHaveBeenCalled();
    expect(sources.fingerprint).not.toHaveBeenCalled();
  });

  it('rejects source changes at the final find verification barrier', async () => {
    const {sources, references} = verification();
    const changed = new GraphNavigationError('stale_reference', 'Source changed.');
    sources.verifyFiles.mockRejectedValue(changed);
    const find = new FindQuery({searchNodes: () => [{node, score: 1}]}, sources, references);
    await expect(find.execute('greet')).rejects.toBe(changed);
  });

  it('rejects changes after symbol source extraction instead of returning source', async () => {
    const {sources, references, reference} = verification();
    const inspect = new InspectQuery({
      getCode: async () => {
        sources.verifyFiles.mockRejectedValue(new GraphNavigationError('stale_reference', 'Source changed.'));
        return 'export function greet() { return "changed"; }';
      },
      getFile: () => null, getNodesInFile: () => [],
    }, sources, references);
    await expect(inspect.execute({reference})).rejects.toMatchObject({code: 'stale_reference'});
  });

  it('preserves the explore error contract when the shared verifier detects a change', async () => {
    const {sources, references} = verification();
    sources.fingerprint.mockResolvedValueOnce(hash)
      .mockRejectedValueOnce(new GraphNavigationError('stale_reference', 'Source changed.'));
    const explore = new ExploreQuery({
      buildContext: async () => JSON.stringify({summary: 'greet', nodes: [node], edges: []}),
      getCode: async () => 'export function greet() {}',
    }, sources, references);
    await expect(explore.execute('greet')).rejects.toBeInstanceOf(GraphSourceChangedError);
  });
});
