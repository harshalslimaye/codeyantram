import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {extendCodeGraphSource, extendCodeGraphExtractionSource, patchCodeGraph} from '../../../scripts/patch-codegraph.mjs';

let root: string;
let original: string;
let originalExtraction: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codeyantram-codegraph-install-'));
  const require = createRequire(import.meta.url);
  const platform = require.resolve(`@colbymchenry/codegraph-${process.platform}-${process.arch}/package.json`);
  const installed = await readFile(path.join(path.dirname(platform), 'lib/dist/index.js'), 'utf8');
  originalExtraction = (await readFile(path.join(path.dirname(platform), 'lib/dist/extraction/index.js'), 'utf8'))
    .replace(/\/\/ Codeyantram extension: ignore Git entries[\s\S]*?(?=function scanDirectory\()/, '')
    .replaceAll('            if (isMissingWorkingTreeFile(rootDir, filePath))\n                continue;\n', '');
  // Recover the original pinned file from either a clean or extended install.
  // Its entire checksum is validated by extendCodeGraphSource, so upgrades fail.
  original = installed
    .replace(/    \/\/ Codeyantram extension:[\s\S]*?(?=    static async init\()/, '')
    .replace("path.join(path.dirname(db.getPath()), 'codegraph.lock')", "path.join((0, directory_2.getCodeGraphDir)(projectRoot), 'codegraph.lock')")
    .replace('fs.statSync(this.db.getPath())', 'fs.statSync((0, db_1.getDatabasePath)(this.projectRoot))');
  await writeFile(path.join(root, 'package.json'), '{}');
  await writePackage('codegraph');
});

afterEach(async () => {await rm(root, {recursive: true, force: true});});

async function writePackage(name: string, {version = '1.6.2', source = original} = {}) {
  const directory = path.join(root, 'node_modules', '@colbymchenry', name);
  await mkdir(path.join(directory, 'lib/dist/extraction'), {recursive: true});
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: `@colbymchenry/${name}`, version}));
  const filename = path.join(directory, 'lib/dist/index.js');
  await writeFile(filename, source);
  await writeFile(path.join(directory, 'lib/dist/extraction/index.js'), originalExtraction);
  return filename;
}

describe('pinned SDK extensions installation', () => {
  it('extends clean platform bundles and is idempotent on reinstall', async () => {
    const files = await Promise.all(['darwin-arm64', 'linux-x64', 'win32-arm64'].map(platform => writePackage(`codegraph-${platform}`)));
    patchCodeGraph(root);
    const first = await Promise.all(files.map(file => readFile(file, 'utf8')));
    expect(first.every(source => source.includes('static async connect(projectRoot, databasePath'))).toBe(true);
    patchCodeGraph(root);
    expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(first);
  });

  it('rejects an SDK version change before touching installed bundles', async () => {
    const file = await writePackage('codegraph-linux-x64');
    await writePackage('codegraph', {version: '1.6.3'});
    expect(() => patchCodeGraph(root)).toThrow('requires 1.6.2');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('validates every installed platform before applying any change', async () => {
    const file = await writePackage('codegraph-darwin-arm64');
    await writePackage('codegraph-linux-x64', {source: original + '\n// modified upstream\n'});
    expect(() => patchCodeGraph(root)).toThrow('Unexpected CodeGraph');
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('rejects platform version skew and missing optional bundles', async () => {
    expect(() => patchCodeGraph(root)).toThrow('Install optional dependencies');
    await writePackage('codegraph-win32-x64', {version: '1.6.3'});
    expect(() => patchCodeGraph(root)).toThrow('bundle must be 1.6.2');
  });

  it('detects changes to an already extended file', () => {
    const extended = extendCodeGraphSource(original);
    expect(extendCodeGraphSource(extended)).toBe(extended);
    expect(() => extendCodeGraphSource(extended.replace('return new CodeGraph', 'return brokenCodeGraph'))).toThrow('Unexpected CodeGraph');
  });

  it('adds the missing-file guard to both Git scan variants and is idempotent', async () => {
    const file = await writePackage('codegraph-linux-x64');
    const extraction = path.join(path.dirname(file), 'extraction/index.js');
    patchCodeGraph(root);
    const extended = await readFile(extraction, 'utf8');
    expect(extended.split('if (isMissingWorkingTreeFile(rootDir, filePath))').length).toBe(3);
    expect(extended).toContain("error.code === 'ENOENT' || error.code === 'ENOTDIR'");
    expect(extendCodeGraphExtractionSource(extended)).toBe(extended);
    patchCodeGraph(root);
    expect(await readFile(extraction, 'utf8')).toBe(extended);
    expect(() => extendCodeGraphExtractionSource(extended.replace("error.code === 'ENOENT'", 'true'))).toThrow('Unexpected CodeGraph');
  });

  it('validates extraction checksums before applying any facade or extraction changes', async () => {
    const file = await writePackage('codegraph-linux-x64');
    const extraction = path.join(path.dirname(file), 'extraction/index.js');
    const changed = originalExtraction + '\n// unknown source\n';
    await writeFile(extraction, changed);
    expect(() => patchCodeGraph(root)).toThrow('Unexpected CodeGraph');
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await readFile(extraction, 'utf8')).toBe(changed);
  });
});
