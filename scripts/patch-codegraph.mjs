import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const EXPECTED_SINGLE_REPLACEMENT_PARTS = 2;
const EXPECTED_DOUBLE_REPLACEMENT_PARTS = 3;

// 1.6.2 has no public factory separating the source root from database storage.
// Extend the facade and fix scans of unstaged Git deletions, preserving resolution
// and locking. Check the release and each complete original file before changes.
const VERSION = '1.6.2';
const ORIGINAL_SHA256 = '1813127b36983344d0cfbf94ecd650ec2d85885ab8936bf7a42f16558ea22b4f';
const EXTRACTION_SHA256 = '34799d83bfdf14d8577b23e29ff32155617fb0e6ace4315744f41c6eb7ee1464';
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];
const originalLock = "path.join((0, directory_2.getCodeGraphDir)(projectRoot), 'codegraph.lock')";
const externalLock = "path.join(path.dirname(db.getPath()), 'codegraph.lock')";
const originalStat = '(0, db_1.getDatabasePath)(this.projectRoot)';
const externalStat = 'this.db.getPath()';
const insertionPoint = '    static async init(projectRoot, options = {}) {';
const factory = `    // Codeyantram extension: keep source and database paths independent.
    static async connect(projectRoot, databasePath, options = {}) {
        await (0, extraction_1.initGrammars)();
        const resolvedRoot = path.resolve(projectRoot);
        const resolvedPath = path.resolve(databasePath);
        const db = options.create
            ? db_1.DatabaseConnection.initialize(resolvedPath)
            : db_1.DatabaseConnection.open(resolvedPath);
        try {
            const queries = new queries_1.QueryBuilder(db.getDb());
            return new CodeGraph(db, queries, resolvedRoot);
        } catch (error) {
            db.close();
            throw error;
        }
    }
`;

/** @param {string} source @param {string} before @param {string} after */
function replaceOnce(source, before, after) {
  if (source.split(before).length !== EXPECTED_SINGLE_REPLACEMENT_PARTS) throw new Error('Unexpected CodeGraph 1.6.2 source; review the storage extension.');
  return source.replace(before, after);
}

/** Exported for compatibility tests; installation calls patchCodeGraph below.
 * @param {string} source
 */
export function extendCodeGraphSource(source) {
  const patched = source.includes(factory);
  let original = source;
  if (patched) {
    original = replaceOnce(original, factory, '');
    original = replaceOnce(original, externalLock, originalLock);
    original = replaceOnce(original, 'fs.statSync(this.db.getPath())', `fs.statSync(${originalStat})`);
  }
  if (createHash('sha256').update(original).digest('hex') !== ORIGINAL_SHA256) {
    throw new Error('Unexpected CodeGraph 1.6.2 source; review the storage extension.');
  }
  if (patched) return source;
  let result = replaceOnce(original, originalLock, externalLock);
  result = replaceOnce(result, originalStat, externalStat);
  return replaceOnce(result, insertionPoint, factory + insertionPoint);
}

const scanLoop = '        for (const filePath of gitFiles) {\n';
const missingFileGuard = '            if (isMissingWorkingTreeFile(rootDir, filePath))\n                continue;\n';
const missingFileHelper = `// Codeyantram extension: ignore Git entries deleted from the working tree.
function isMissingWorkingTreeFile(rootDir, filePath) {
    try {
        fs.statSync(path.join(rootDir, filePath));
        return false;
    } catch (error) {
        // Keep permission and other I/O failures visible to the indexer.
        return error.code === 'ENOENT' || error.code === 'ENOTDIR';
    }
}
`;

/** Git still lists unstaged deletions; neither index nor sync should read them.
 * @param {string} source
 */
export function extendCodeGraphExtractionSource(source) {
  const patched = source.includes(missingFileHelper);
  let original = source;
  if (patched) {
    original = replaceOnce(original, missingFileHelper, '');
    if (original.split(missingFileGuard).length !== EXPECTED_DOUBLE_REPLACEMENT_PARTS) throw new Error('Unexpected CodeGraph 1.6.2 extraction source; review the working-tree fix.');
    original = original.replaceAll(missingFileGuard, '');
  }
  if (createHash('sha256').update(original).digest('hex') !== EXTRACTION_SHA256) {
    throw new Error('Unexpected CodeGraph 1.6.2 extraction source; review the working-tree fix.');
  }
  if (patched) return source;
  if (original.split(scanLoop).length !== EXPECTED_DOUBLE_REPLACEMENT_PARTS) throw new Error('Unexpected CodeGraph 1.6.2 scan loops; review the working-tree fix.');
  return replaceOnce(original.replaceAll(scanLoop, scanLoop + missingFileGuard),
    'function scanDirectory(rootDir, onProgress) {', missingFileHelper + 'function scanDirectory(rootDir, onProgress) {');
}

export function patchCodeGraph(root = fileURLToPath(new URL('../', import.meta.url))) {
  const require = createRequire(path.join(root, 'package.json'));
  const main = /** @type {{version: string}} */ (require('@colbymchenry/codegraph/package.json'));
  if (main.version !== VERSION) throw new Error(`CodeGraph storage extension requires ${VERSION}; found ${main.version}.`);
  const updates = [];
  for (const platform of platforms) {
    let packageFile;
    try {
      packageFile = require.resolve(`@colbymchenry/codegraph-${platform}/package.json`);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    const metadata = /** @type {{version: string}} */ (JSON.parse(readFileSync(packageFile, 'utf8')));
    if (metadata.version !== VERSION) throw new Error(`CodeGraph ${platform} bundle must be ${VERSION}; found ${metadata.version}.`);
    for (const [relative, extend] of /** @type {[string, (source: string) => string][]} */ ([['index.js', extendCodeGraphSource], ['extraction/index.js', extendCodeGraphExtractionSource]])) {
      const filename = path.join(path.dirname(packageFile), 'lib', 'dist', relative);
      const source = readFileSync(filename, 'utf8');
      updates.push({filename, source, extended: extend(source)});
    }
  }
  if (!updates.length) throw new Error('No CodeGraph platform bundle is installed. Install optional dependencies.');
  // Validate every installed bundle before modifying any of them. Reruns heal
  // an interrupted install; unknown source fails instead of patching blindly.
  for (const {filename, source, extended} of updates) {
    if (source !== extended) writeFileSync(filename, extended);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) patchCodeGraph();
