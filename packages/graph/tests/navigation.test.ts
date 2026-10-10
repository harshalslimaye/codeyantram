import {requireValue, asymmetric} from '../../shared/tests/helpers.js';
import type * as SharedModule from '@codeyantram/shared';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {mkdtemp, mkdir, rm, rename, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory, symbolReferenceSchema} from '@codeyantram/shared';
import {GraphCoordinator, openWorkspaceGraph, type GraphNavigationSymbol, type WorkspaceGraph} from '../src/index.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof SharedModule>(), getUserGraphDirectory: vi.fn<typeof getUserGraphDirectory>(),
}));
let directory: string, root: string, graph: WorkspaceGraph;
const graphs: WorkspaceGraph[] = [];
const helper = 'export function greet() { return "hello"; }\n';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-navigation-'));
  root = path.join(directory, 'project');
  await mkdir(path.join(root, 'src'), {recursive: true});
  vi.mocked(getUserGraphDirectory).mockReturnValue(path.join(directory, 'global', 'graphs'));
  await Promise.all([
    writeFile(path.join(root, 'src/helper.ts'), helper),
    writeFile(path.join(root, 'src/main.ts'), 'import {greet} from "./helper";\nexport function welcome() { return greet(); }\n'),
    writeFile(path.join(root, 'src/app.ts'), 'import {welcome} from "./main";\nexport function launch() { return welcome(); }\n'),
    writeFile(path.join(root, 'src/duplicate.ts'), 'export function greet() { return "other"; }\n'),
    writeFile(path.join(root, 'excluded.ts'), 'export function excluded() {}\n'),
    writeFile(path.join(root, '.gitignore'), 'excluded.ts\n'),
  ]);
  graph = await openWorkspaceGraph(root); graphs.push(graph);
  const report = await graph.index();
  if (!report.success) throw new Error('Expected the navigation fixture to index successfully.');
});
afterEach(async () => {
  await Promise.all(graphs.splice(0).map(openedGraph => openedGraph.close()));
  await rm(directory, {recursive: true, force: true});
});

async function locate(name: string, filePath: string): Promise<GraphNavigationSymbol> {
  const result = await graph.find(name);
  const symbol = result.matches.find(match => match.symbol.name === name && match.symbol.filePath === filePath)?.symbol;
  if (!symbol) throw new Error('Expected fixture symbol');
  return symbol;
}

describe('installed SDK focused navigation', () => {
  it('returns ambiguous candidates and reusable verified references from find and explore', async () => {
    const found = await graph.find('greet');
    expect(found.matches.filter(match => match.symbol.name === 'greet')).toHaveLength(2);
    expect(found.coverage).toContain('Empty results do not prove absence');
    const greet = await locate('greet', 'src/helper.ts');
    expect(symbolReferenceSchema.parse(greet.reference)).toEqual(greet.reference);
    expect(greet.reference.contentHash).toBe(createHash('sha256').update(helper).digest('hex'));
    const context = await graph.explore('greet');
    const explored = requireValue(context.symbols.find(symbol => symbol.id === greet.id));
    expect(explored.reference).toEqual(greet.reference);
    expect(await graph.inspect({reference: explored.reference})).toMatchObject({type: 'symbol', source: {text: asymmetric.stringContaining('hello'), truncated: false}});
    expect((await graph.find('excluded')).matches).toEqual([]);
  });

  it('returns ordered indexed file outlines and rejects unindexed and outside paths', async () => {
    const outline = await graph.inspect({filePath: 'src/main.ts'});
    expect(outline).toMatchObject({type: 'file', filePath: 'src/main.ts'});
    if (outline.type !== 'file') throw new Error('Expected outline');
    expect(outline.symbols.map(symbol => symbol.name)).toContain('welcome');
    expect(outline.symbols.every(symbol => symbolReferenceSchema.safeParse(symbol.reference).success)).toBe(true);
    expect(outline.symbols.map(symbol => symbol.startLine)).toEqual(outline.symbols.map(symbol => symbol.startLine).sort((a, b) => a - b));
    await expect(graph.inspect({filePath: 'excluded.ts'})).rejects.toMatchObject({code: 'not_found'});
    await expect(graph.inspect({filePath: '../outside.ts'})).rejects.toMatchObject({code: 'invalid_input'});
    await expect(graph.inspect({filePath: path.join(root, 'src/main.ts')})).rejects.toMatchObject({code: 'invalid_input'});
  });

  it('follows callers/callees in the requested direction and honors depth with edge locations', async () => {
    const greet = await locate('greet', 'src/helper.ts');
    const immediate = await graph.trace(greet.reference, {direction: 'callers'});
    expect(immediate.symbols.map(symbol => symbol.name)).toEqual(['welcome']);
    expect(immediate.relationships).toContainEqual(asymmetric.objectContaining({source: immediate.symbols[0].id, target: greet.id, kind: 'calls', line: 2}));
    const transitive = await graph.trace(greet.reference, {direction: 'callers', depth: 2});
    expect(transitive.symbols.map(symbol => symbol.name)).toEqual(['welcome', 'launch']);
    const limited = await graph.trace(greet.reference, {direction: 'callers', depth: 2, limit: 1});
    expect(limited.symbols.map(symbol => symbol.name)).toEqual(['welcome']);
    expect(limited.truncated).toBe(true);
    expect(limited.relationships.every(edge => [greet.id, limited.symbols[0].id].includes(edge.source)
      && [greet.id, limited.symbols[0].id].includes(edge.target))).toBe(true);
    const welcome = await locate('welcome', 'src/main.ts');
    const callees = await graph.trace(welcome.reference, {direction: 'callees'});
    expect(callees.symbols.map(symbol => symbol.id)).toEqual([greet.id]);
    expect(callees.coverage).toContain('dynamic or unresolved calls');
  });

  it('preserves references through no-op scans and unrelated edits but rejects changed content and moved symbols', async () => {
    const coordinator = new GraphCoordinator(graph);
    const found = await coordinator.query(reader => reader.find('greet'));
    const reference = requireValue(found.value.matches.find(match => match.symbol.filePath === 'src/helper.ts')).symbol.reference;
    const before = await coordinator.query(reader => reader.inspect({reference}));
    expect(before.freshness.revision).toBeGreaterThan(found.freshness.revision);
    await writeFile(path.join(root, 'src/unrelated.ts'), 'export function unrelated() {}\n');
    expect((await coordinator.query(reader => reader.inspect({reference}))).value).toMatchObject({type: 'symbol'});
    await writeFile(path.join(root, 'src/helper.ts'), 'export function greet() { return "updated"; }\n');
    await expect(coordinator.query(reader => reader.inspect({reference}))).rejects.toMatchObject({code: 'stale_reference'});
    await expect(coordinator.query(reader => reader.trace(reference, {direction: 'callers'}))).rejects.toMatchObject({code: 'stale_reference'});
    const current = await locate('greet', 'src/helper.ts');
    expect(await graph.inspect({reference: current.reference})).toMatchObject({source: {text: asymmetric.stringContaining('updated')}});
    await rename(path.join(root, 'src/helper.ts'), path.join(root, 'src/moved.ts'));
    await expect(coordinator.query(reader => reader.inspect({reference: current.reference}))).rejects.toMatchObject({code: 'stale_reference'});
    await coordinator.close();
  });

  it('rejects foreign workspace references and source edits during reads', async () => {
    const greet = await locate('greet', 'src/helper.ts');
    await expect(graph.inspect({reference: {...greet.reference, workspaceId: '0'.repeat(64)}})).rejects.toMatchObject({code: 'stale_reference'});
    const reading = graph.inspect({reference: greet.reference});
    writeFileSync(path.join(root, 'src/helper.ts'), 'export function greet() { return "racing edit"; }\n');
    await expect(reading).rejects.toMatchObject({code: 'stale_reference'});
  });

  it('omits oversized candidates and refuses oversized source without returning it', async () => {
    const greet = await locate('greet', 'src/helper.ts');
    await writeFile(path.join(root, 'src/helper.ts'), helper + '// ' + 'x'.repeat(1024 * 1024));
    await expect(graph.inspect({reference: greet.reference})).rejects.toMatchObject({code: 'source_too_large'});
    const found = await graph.find('greet');
    expect(found.truncated).toBe(true);
    expect(found.matches.some(match => match.symbol.filePath === 'src/helper.ts')).toBe(false);
  });

  it('bounds candidates, outlines, source, and cyclic traversal without dangling relationships', async () => {
    await writeFile(path.join(root, 'src/many.ts'), Array.from({length: 80}, (_, i) => `export function item${i}() { return ${i}; }`).join('\n'));
    await writeFile(path.join(root, 'src/large.ts'), 'export function big() {\n' + '  console.log("long source");\n'.repeat(300) + '}\n');
    await writeFile(path.join(root, 'src/cycle.ts'), 'export function first() { return second(); }\nexport function second() { return first(); }\n');
    await graph.sync();
    const found = await graph.find('item', {limit: 1, maxCharacters: 2048});
    expect(found.matches.length).toBeLessThanOrEqual(1); expect(found.truncated).toBe(true);
    expect(JSON.stringify(found).length).toBeLessThanOrEqual(2048);
    const outline = await graph.inspect({filePath: 'src/many.ts'}, {limit: 50, maxCharacters: 2048});
    expect(outline.truncated).toBe(true); expect(JSON.stringify(outline).length).toBeLessThanOrEqual(2048);
    const big = await locate('big', 'src/large.ts');
    const inspected = await graph.inspect({reference: big.reference}, {maxCharacters: 2048});
    expect(inspected).toMatchObject({truncated: true, source: {truncated: true}});
    expect(JSON.stringify(inspected).length).toBeLessThanOrEqual(2048);
    const first = await locate('first', 'src/cycle.ts');
    const traced = await graph.trace(first.reference, {direction: 'callees', depth: 3, limit: 1, maxCharacters: 2048});
    expect(traced.symbols).toHaveLength(1);
    expect(new Set(traced.symbols.map(symbol => symbol.id)).size).toBe(traced.symbols.length);
    const ids = new Set([traced.target.id, ...traced.symbols.map(symbol => symbol.id)]);
    expect(traced.relationships.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(JSON.stringify(traced).length).toBeLessThanOrEqual(2048);
  });
});
