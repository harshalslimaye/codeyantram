import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_CATALOG, isReadOnlyTool } from '@codeyantram/shared';
import { buildProjectTools } from '../../src/tools';
import { MAX_EDIT_FILE_BYTES } from '../../src/tools/shared';

let projectDir: string;

beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'codeyantram-tools-'));
});

afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
});

// execute() only reads its first argument in these tools - the second
// (ToolExecutionOptions) is required by the type but unused here.
const NO_OPTIONS = {} as never;

async function run(cwd: string, name: string, input: unknown): Promise<string> {
    const tools = buildProjectTools(cwd);
    const execute = tools[name]?.execute;
    if (execute === undefined) throw new Error(`no executable tool named "${name}"`);
    return (await execute(input, NO_OPTIONS)) as string;
}

describe('buildProjectTools', () => {
    test('declares every catalog tool', () => {
        const tools = buildProjectTools(projectDir);
        for (const definition of TOOL_CATALOG) {
            expect(tools[definition.name]).toBeDefined();
        }
    });

    test('only mutating tools need approval', () => {
        const tools = buildProjectTools(projectDir);
        for (const definition of TOOL_CATALOG) {
            expect(tools[definition.name]?.needsApproval).toBe(!isReadOnlyTool(definition.name));
        }
    });
});

describe('read_file', () => {
    test('reads a file relative to the project root', async () => {
        await Bun.write(join(projectDir, 'hello.txt'), 'hi there');
        expect(await run(projectDir, 'read_file', { path: 'hello.txt' })).toBe('hi there');
    });

    test('rejects a path that escapes the project root', async () => {
        const result = await run(projectDir, 'read_file', { path: '../outside.txt' });
        expect(result).toContain('Error:');
        expect(result).toContain('outside the project root');
    });

    test('rejects a binary file instead of returning garbled text', async () => {
        await Bun.write(join(projectDir, 'binary.dat'), Buffer.from([0, 1, 2, 3, 255, 254]));
        const result = await run(projectDir, 'read_file', { path: 'binary.dat' });
        expect(result).toContain('Error:');
        expect(result).toContain('Cannot read binary file');
    });

    test('truncates output past MAX_OUTPUT_CHARS', async () => {
        await Bun.write(join(projectDir, 'big.txt'), 'x'.repeat(25_000));
        const result = await run(projectDir, 'read_file', { path: 'big.txt' });
        expect(result.length).toBeLessThan(25_000);
        expect(result).toContain('truncated');
    });
});

describe('list_dir', () => {
    test('lists files and directories, marking directories with a trailing slash', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        mkdirSync(join(projectDir, 'sub'));

        const result = await run(projectDir, 'list_dir', { path: '.' });
        expect(result.split('\n').sort()).toEqual(['a.txt', 'sub/']);
    });

    test('truncates past maxResults entries', async () => {
        for (let i = 0; i < 10; i++) {
            await Bun.write(join(projectDir, `file${i}.txt`), '');
        }

        const result = await run(projectDir, 'list_dir', { path: '.', maxResults: 5 });
        const lines = result.split('\n');
        expect(lines.filter(line => line.endsWith('.txt'))).toHaveLength(5);
        expect(result).toContain('… 5 more entries truncated (maxResults=5)');
    });

    test('hides dotfiles and dotdirs by default, shows them with includeHidden', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        await Bun.write(join(projectDir, '.env'), '');
        mkdirSync(join(projectDir, '.git'));

        const hidden = await run(projectDir, 'list_dir', { path: '.' });
        expect(hidden.split('\n').sort()).toEqual(['a.txt']);

        const shown = await run(projectDir, 'list_dir', { path: '.', includeHidden: true });
        expect(shown.split('\n').sort()).toEqual(['.env', '.git/', 'a.txt']);
    });

    test('errors cleanly when the path is a file, not a directory', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        const result = await run(projectDir, 'list_dir', { path: 'a.txt' });
        expect(result).toContain('Error:');
        expect(result).toContain('is not a directory');
    });

    test('errors cleanly when the path does not exist', async () => {
        const result = await run(projectDir, 'list_dir', { path: 'missing' });
        expect(result).toContain('Error:');
        expect(result).toContain('does not exist');
    });

    test('marks a symlink to a directory with a trailing slash, not just a symlink to a file', async () => {
        mkdirSync(join(projectDir, 'realdir'));
        await Bun.write(join(projectDir, 'realfile.txt'), '');
        symlinkSync(join(projectDir, 'realdir'), join(projectDir, 'linktodir'));
        symlinkSync(join(projectDir, 'realfile.txt'), join(projectDir, 'linktofile'));

        const result = await run(projectDir, 'list_dir', { path: '.' });
        expect(result.split('\n').sort()).toEqual(['linktodir/', 'linktofile', 'realdir/', 'realfile.txt']);
    });

    test('lists a broken symlink as a plain name instead of erroring', async () => {
        symlinkSync(join(projectDir, 'does-not-exist'), join(projectDir, 'broken-link'));

        const result = await run(projectDir, 'list_dir', { path: '.' });
        expect(result).toBe('broken-link');
    });

    test('is not recursive by default', async () => {
        await Bun.write(join(projectDir, 'sub/nested.txt'), '');

        const result = await run(projectDir, 'list_dir', { path: '.' });
        expect(result.split('\n').sort()).toEqual(['sub/']);
    });

    test('recursive descends into subdirectories', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        await Bun.write(join(projectDir, 'sub/nested.txt'), '');
        await Bun.write(join(projectDir, 'sub/deeper/leaf.txt'), '');

        const result = await run(projectDir, 'list_dir', { path: '.', recursive: true });
        expect(result.split('\n').sort()).toEqual(['a.txt', 'sub/', 'sub/deeper/', 'sub/deeper/leaf.txt', 'sub/nested.txt']);
    });

    test('depth limits recursion and implies recursive', async () => {
        await Bun.write(join(projectDir, 'sub/nested.txt'), '');
        await Bun.write(join(projectDir, 'sub/deeper/leaf.txt'), '');

        const result = await run(projectDir, 'list_dir', { path: '.', depth: 1 });
        expect(result.split('\n').sort()).toEqual(['sub/']);
    });

    test('recursive skips descending into node_modules, .git, dist, and build', async () => {
        await Bun.write(join(projectDir, 'real.js'), '');
        await Bun.write(join(projectDir, 'node_modules/pkg/index.js'), '');
        await Bun.write(join(projectDir, '.git/config'), '');
        await Bun.write(join(projectDir, 'dist/bundle.js'), '');
        await Bun.write(join(projectDir, 'build/output.js'), '');

        const result = await run(projectDir, 'list_dir', { path: '.', recursive: true });

        expect(result).toContain('real.js');
        expect(result).not.toContain('pkg');
        expect(result).not.toContain('.git/config');
        expect(result).not.toContain('dist/bundle.js');
        expect(result).not.toContain('build/output.js');
    });

    test('a flat top-level listing still shows node_modules itself as one entry', async () => {
        await Bun.write(join(projectDir, 'node_modules/pkg/index.js'), '');

        const result = await run(projectDir, 'list_dir', { path: '.' });
        expect(result.split('\n')).toEqual(['node_modules/']);
    });

    test('does not hang on a circular symlink when recursing without an explicit depth', async () => {
        mkdirSync(join(projectDir, 'sub'));
        symlinkSync(projectDir, join(projectDir, 'sub', 'loop'));

        // The DEFAULT_MAX_DEPTH safety ceiling is what keeps this from recursing
        // forever - if this test hangs, that ceiling has regressed.
        const result = await run(projectDir, 'list_dir', { path: '.', recursive: true });
        expect(result).toContain('sub/');
    });

    test('withMetadata reports type, size, and mtime as tab-separated fields', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'hello');
        mkdirSync(join(projectDir, 'sub'));

        const result = await run(projectDir, 'list_dir', { path: '.', withMetadata: true });
        const lines = result.split('\n').sort();

        const [fileName, fileType, fileSize] = lines[0]!.split('\t');
        expect(fileName).toBe('a.txt');
        expect(fileType).toBe('file');
        expect(fileSize).toBe('5');

        const [dirName, dirType] = lines[1]!.split('\t');
        expect(dirName).toBe('sub/');
        expect(dirType).toBe('dir');
    });

    test('withMetadata reports a symlink as its own type, distinct from file or dir', async () => {
        mkdirSync(join(projectDir, 'realdir'));
        symlinkSync(join(projectDir, 'realdir'), join(projectDir, 'linktodir'));
        symlinkSync(join(projectDir, 'does-not-exist'), join(projectDir, 'broken-link'));

        const result = await run(projectDir, 'list_dir', { path: '.', withMetadata: true });
        const types = Object.fromEntries(result.split('\n').map(line => line.split('\t').slice(0, 2)));

        expect(types['realdir/']).toBe('dir');
        expect(types['linktodir/']).toBe('symlink');
        expect(types['broken-link']).toBe('symlink');
    });
});

describe('glob', () => {
    test('finds files matching the pattern', async () => {
        await Bun.write(join(projectDir, 'a.ts'), '');
        await Bun.write(join(projectDir, 'b.md'), '');

        expect(await run(projectDir, 'glob', { pattern: '*.ts' })).toBe('a.ts');
    });

    test('reports no matches rather than an empty string', async () => {
        expect(await run(projectDir, 'glob', { pattern: '*.rs' })).toBe('No matches.');
    });

    test('returns matches in sorted order', async () => {
        await Bun.write(join(projectDir, 'c.ts'), '');
        await Bun.write(join(projectDir, 'a.ts'), '');
        await Bun.write(join(projectDir, 'b.ts'), '');

        expect(await run(projectDir, 'glob', { pattern: '*.ts' })).toBe('a.ts\nb.ts\nc.ts');
    });

    test('rejects a pattern with a ".." segment', async () => {
        const result = await run(projectDir, 'glob', { pattern: '../../etc/**' });
        expect(result).toContain('Error:');
        expect(result).toContain('must not contain ".." segments');
    });

    test('rejects an absolute pattern', async () => {
        const result = await run(projectDir, 'glob', { pattern: '/etc/**' });
        expect(result).toContain('Error:');
        expect(result).toContain('must be relative to the project root');
    });

    test('excludes node_modules, .git, dist, and build even without a .gitignore', async () => {
        await Bun.write(join(projectDir, 'real.js'), '');
        await Bun.write(join(projectDir, 'node_modules/pkg/index.js'), '');
        await Bun.write(join(projectDir, '.git/config'), '');
        await Bun.write(join(projectDir, 'dist/bundle.js'), '');
        await Bun.write(join(projectDir, 'build/output.js'), '');

        const result = await run(projectDir, 'glob', { pattern: '**/*.js' });

        expect(result).toContain('real.js');
        expect(result).not.toContain('node_modules');
        expect(result).not.toContain('.git');
        expect(result).not.toContain('dist/bundle.js');
        expect(result).not.toContain('build/output.js');
    });

    test('excludes files matched by the project .gitignore', async () => {
        await Bun.write(join(projectDir, '.gitignore'), 'coverage\n*.log\n');
        await Bun.write(join(projectDir, 'keep.txt'), '');
        await Bun.write(join(projectDir, 'coverage/report.txt'), '');
        await Bun.write(join(projectDir, 'debug.log'), '');

        const result = await run(projectDir, 'glob', { pattern: '**/*' });

        expect(result).toContain('keep.txt');
        expect(result).not.toContain('coverage');
        expect(result).not.toContain('debug.log');
    });

    test('works normally when there is no .gitignore', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        expect(await run(projectDir, 'glob', { pattern: '*.txt' })).toBe('a.txt');
    });

    test('hides dotfiles and dotdirs by default, shows them with dot', async () => {
        await Bun.write(join(projectDir, 'a.txt'), '');
        await Bun.write(join(projectDir, '.env.local'), '');

        const hidden = await run(projectDir, 'glob', { pattern: '**/*' });
        expect(hidden).not.toContain('.env.local');

        const shown = await run(projectDir, 'glob', { pattern: '**/*', dot: true });
        expect(shown).toContain('.env.local');
    });

    test('maxResults caps matches and reports truncation', async () => {
        for (let i = 0; i < 10; i++) {
            await Bun.write(join(projectDir, `file${i}.txt`), '');
        }

        const result = await run(projectDir, 'glob', { pattern: '*.txt', maxResults: 5 });
        const lines = result.split('\n');

        expect(lines.filter(line => line.endsWith('.txt'))).toHaveLength(5);
        expect(result).toContain('… 5 more matches truncated (maxResults=5)');
    });

    test('rejects an empty pattern at the schema level rather than reaching execute()', () => {
        const globDef = TOOL_CATALOG.find(definition => definition.name === 'glob');
        expect(globDef?.inputSchema.safeParse({ pattern: '' }).success).toBe(false);
    });

    test('surfaces a clean error instead of fast-glob\'s raw wording for a malformed pattern', async () => {
        // Exceeds picomatch's own internal length guard, a real (not hypothetical)
        // fast-glob throw - safeGlob normalizes it rather than letting it leak through.
        const result = await run(projectDir, 'glob', { pattern: 'a{'.repeat(50_000) });

        expect(result).toContain('Error:');
        expect(result).toContain('Invalid glob pattern');
    });
});

describe('grep', () => {
    test('finds a pattern inside a file', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'needle\nhaystack');
        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.' });
        expect(result).toContain('needle');
    });

    test('reports no matches rather than an empty string', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'nothing here');
        expect(await run(projectDir, 'grep', { pattern: 'needle', path: '.' })).toBe('No matches.');
    });

    test('excludes node_modules, .git, dist, and build even without a .gitignore', async () => {
        await Bun.write(join(projectDir, 'real.js'), 'needle');
        await Bun.write(join(projectDir, 'node_modules/pkg/index.js'), 'needle');
        await Bun.write(join(projectDir, '.git/config'), 'needle');
        await Bun.write(join(projectDir, 'dist/bundle.js'), 'needle');
        await Bun.write(join(projectDir, 'build/output.js'), 'needle');

        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.' });

        expect(result).toContain('real.js');
        expect(result).not.toContain('node_modules');
        expect(result).not.toContain('.git/config');
        expect(result).not.toContain('dist/bundle.js');
        expect(result).not.toContain('build/output.js');
    });

    test('ignoreCase finds a differently-cased match', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'NEEDLE');
        expect(await run(projectDir, 'grep', { pattern: 'needle', path: '.', ignoreCase: true })).toContain('NEEDLE');
    });

    test('glob restricts matches to the given file set', async () => {
        await Bun.write(join(projectDir, 'a.ts'), 'needle');
        await Bun.write(join(projectDir, 'b.md'), 'needle');

        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.', glob: '*.ts' });

        expect(result).toContain('a.ts');
        expect(result).not.toContain('b.md');
    });

    test('contextLines includes surrounding lines', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'before\nneedle\nafter');
        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.', contextLines: 1 });

        expect(result).toContain('before');
        expect(result).toContain('needle');
        expect(result).toContain('after');
    });

    test('filesOnly returns filenames without line content', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'needle');
        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.', filesOnly: true });

        expect(result.trim()).toBe('a.txt');
    });

    test('maxResults caps matches and reports truncation', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'needle\n'.repeat(5));
        const result = await run(projectDir, 'grep', { pattern: 'needle', path: '.', maxResults: 2 });

        expect(result.match(/needle/g)?.length).toBe(2);
        expect(result).toContain('truncated');
    });

    test('surfaces a real error distinctly from "No matches."', async () => {
        const result = await run(projectDir, 'grep', { pattern: '(unclosed', path: '.' });
        expect(result).toContain('Error:');
        expect(result).not.toBe('No matches.');
    });

    test('skips binary file contents', async () => {
        await Bun.write(join(projectDir, 'binary.dat'), Buffer.from([0, 1, 2, 3, 255, 254, ...Buffer.from('needle')]));
        expect(await run(projectDir, 'grep', { pattern: 'needle', path: '.' })).toBe('No matches.');
    });
});

describe('write_file', () => {
    test('creates a file, including its parent directories', async () => {
        const result = await run(projectDir, 'write_file', { path: 'nested/dir/file.txt', content: 'content' });
        expect(result).toBe('Wrote nested/dir/file.txt');
        expect(await readFile(join(projectDir, 'nested/dir/file.txt'), 'utf-8')).toBe('content');
    });

    test('overwrites an existing file entirely', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'old');
        await run(projectDir, 'write_file', { path: 'a.txt', content: 'new' });
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('new');
    });
});

describe('edit_file', () => {
    test('replaces a unique snippet', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'bar', newText: 'qux' }] });
        expect(result).toBe('Edited a.txt');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo qux baz');
    });

    test('errors, without writing, when oldText is not found', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'nope', newText: 'x' }] });
        expect(result).toContain('Error:');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
    });

    test('errors, without writing, when oldText matches more than once', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo foo foo');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'x' }] });
        expect(result).toContain('Error:');
        expect(result).toContain('3 locations');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo foo foo');
    });

    test('multi-match error lists each match line as path:line', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo\nbar\nfoo\nbaz\nfoo');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'x' }] });

        expect(result).toContain('a.txt:1');
        expect(result).toContain('a.txt:3');
        expect(result).toContain('a.txt:5');
    });

    test('multi-match error truncates past MAX_MATCH_LOCATIONS_SHOWN and reports the remainder', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo\n'.repeat(7));
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'x' }] });

        expect(result).toContain('7 locations');
        expect(result).toContain('a.txt:1');
        expect(result).toContain('a.txt:5');
        expect(result).not.toContain('a.txt:6');
        expect(result).toContain('and 2 more');
    });

    test('treats $ in newText as a literal, not a String.replace pattern token', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [{ oldText: 'bar', newText: 'price: $1.99 ($&)' }],
        });
        expect(result).toBe('Edited a.txt');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo price: $1.99 ($&) baz');
    });

    test('hints at a line-ending mismatch when oldText is CRLF but the file is LF', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo\nbar\nbaz');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo\r\nbar', newText: 'x' }] });

        expect(result).toContain('Error:');
        expect(result).toContain('file uses LF line endings but oldText uses CRLF');
    });

    test('rejects a file over MAX_EDIT_FILE_BYTES without reading or writing it', async () => {
        const target = join(projectDir, 'big.txt');
        await Bun.write(target, Buffer.alloc(MAX_EDIT_FILE_BYTES + 1, 'x'));

        const result = await run(projectDir, 'edit_file', { path: 'big.txt', edits: [{ oldText: 'x', newText: 'y' }] });

        expect(result).toContain('Error:');
        expect(result).toContain('over the');
        expect((await stat(target)).size).toBe(MAX_EDIT_FILE_BYTES + 1);
    });

    test('applies multiple edits to distinct spots atomically', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [
                { oldText: 'foo', newText: 'FOO' },
                { oldText: 'baz', newText: 'BAZ' },
            ],
        });

        expect(result).toBe('Applied 2 edits to a.txt');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('FOO bar BAZ');
    });

    test('rejects a batch where a later edit targets text only an earlier edit would create - each oldText must match the original content, not a chained intermediate', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [
                { oldText: 'foo', newText: 'foobar' },
                { oldText: 'foobar', newText: 'foobarbaz' },
            ],
        });

        expect(result).toContain('Error:');
        expect(result).toContain('edit 2/2');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo');
    });

    test('when one edit in a batch fails up front, none of them are written', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [
                { oldText: 'foo', newText: 'FOO' },
                { oldText: 'missing', newText: 'X' },
            ],
        });

        expect(result).toContain('Error:');
        expect(result).toContain('edit 2/2');
        expect(result).toContain('oldText not found');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
    });

    test('reports every failing edit in a batch, not just the first', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [
                { oldText: 'nope', newText: 'X' },
                { oldText: 'also-nope', newText: 'Y' },
            ],
        });

        expect(result).toContain('edit 1/2');
        expect(result).toContain('edit 2/2');
    });

    test('aborts without writing when an earlier edit invalidates a later one', async () => {
        // Both 'foo' and 'bar' are independently unique against the original content, but
        // rewriting 'foo' to 'bar' makes the second edit's oldText match twice.
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar');
        const result = await run(projectDir, 'edit_file', {
            path: 'a.txt',
            edits: [
                { oldText: 'foo', newText: 'bar' },
                { oldText: 'bar', newText: 'baz' },
            ],
        });

        expect(result).toContain('Error:');
        expect(result).toContain('caused by an earlier edit in this batch');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar');
    });

    describe('dryRun', () => {
        test('returns a diff without writing the file', async () => {
            await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
            const result = await run(projectDir, 'edit_file', {
                path: 'a.txt',
                edits: [{ oldText: 'bar', newText: 'qux' }],
                dryRun: true,
            });

            expect(result).toContain('Dry run - no changes written to a.txt');
            expect(result).toContain('@@ a.txt:1 (edit) @@');
            expect(result).toContain('-foo bar baz');
            expect(result).toContain('+foo qux baz');
            expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
        });

        test('expands a mid-line match to the full line, at the correct line number', async () => {
            await Bun.write(join(projectDir, 'a.txt'), 'line1\nline2\nline3');
            const result = await run(projectDir, 'edit_file', {
                path: 'a.txt',
                edits: [{ oldText: 'line2', newText: 'LINE2' }],
                dryRun: true,
            });

            expect(result).toContain('@@ a.txt:2 (edit) @@');
            expect(result).toContain('-line2');
            expect(result).toContain('+LINE2');
            expect(result).not.toContain('line1\n-'); // the untouched lines aren't part of the hunk
        });

        test('renders one hunk per edit, in order, for a multi-edit batch', async () => {
            await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
            const result = await run(projectDir, 'edit_file', {
                path: 'a.txt',
                edits: [
                    { oldText: 'foo', newText: 'FOO' },
                    { oldText: 'baz', newText: 'BAZ' },
                ],
                dryRun: true,
            });

            expect(result).toContain('@@ a.txt:1 (edit 1/2) @@');
            expect(result).toContain('@@ a.txt:1 (edit 2/2) @@');
            expect(result.indexOf('edit 1/2')).toBeLessThan(result.indexOf('edit 2/2'));
            expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
        });

        test('still reports a validation error instead of a diff when oldText is not found', async () => {
            await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
            const result = await run(projectDir, 'edit_file', {
                path: 'a.txt',
                edits: [{ oldText: 'nope', newText: 'x' }],
                dryRun: true,
            });

            expect(result).toContain('Error:');
            expect(result).not.toContain('Dry run');
        });

        test('still catches an in-batch overlap and writes nothing', async () => {
            await Bun.write(join(projectDir, 'a.txt'), 'foo bar');
            const result = await run(projectDir, 'edit_file', {
                path: 'a.txt',
                edits: [
                    { oldText: 'foo', newText: 'bar' },
                    { oldText: 'bar', newText: 'baz' },
                ],
                dryRun: true,
            });

            expect(result).toContain('Error:');
            expect(result).toContain('caused by an earlier edit in this batch');
            expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar');
        });
    });
});

describe('undo_edit', () => {
    test('restores the state from immediately before the last edit_file write', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'bar', newText: 'qux' }] });
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo qux baz');

        const result = await run(projectDir, 'undo_edit', { path: 'a.txt' });

        expect(result).toContain('Reverted a.txt');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
    });

    test('steps back one edit at a time across multiple edit_file writes', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'v1');
        await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'v1', newText: 'v2' }] });
        await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'v2', newText: 'v3' }] });
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('v3');

        await run(projectDir, 'undo_edit', { path: 'a.txt' });
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('v2');

        await run(projectDir, 'undo_edit', { path: 'a.txt' });
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('v1');
    });

    test('errors when there is no backup for the path', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'untouched');
        const result = await run(projectDir, 'undo_edit', { path: 'a.txt' });

        expect(result).toContain('Error:');
        expect(result).toContain('no edit_file backup available');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('untouched');
    });

    test('errors once the backup stack for a path is exhausted', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo');
        await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'bar' }] });
        await run(projectDir, 'undo_edit', { path: 'a.txt' });

        const result = await run(projectDir, 'undo_edit', { path: 'a.txt' });
        expect(result).toContain('Error:');
        expect(result).toContain('no edit_file backup available');
    });

    test('a dryRun edit_file call does not create a backup to undo', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar');
        await run(projectDir, 'edit_file', { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'FOO' }], dryRun: true });

        const result = await run(projectDir, 'undo_edit', { path: 'a.txt' });
        expect(result).toContain('Error:');
        expect(result).toContain('no edit_file backup available');
    });

    test('does not cover a write_file write', async () => {
        await run(projectDir, 'write_file', { path: 'a.txt', content: 'from write_file' });
        const result = await run(projectDir, 'undo_edit', { path: 'a.txt' });

        expect(result).toContain('Error:');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('from write_file');
    });
});

describe('bash', () => {
    test('runs a command in the project root and returns its output', async () => {
        expect(await run(projectDir, 'bash', { command: 'echo hi' })).toBe('hi');
    });

    test('captures a non-zero exit as part of the returned output rather than throwing', async () => {
        const result = await run(projectDir, 'bash', { command: 'exit 1' });
        expect(result).toBe('Error (exit 1): (no output)');
    });

    test('reports a command killed by a signal', async () => {
        const result = await run(projectDir, 'bash', { command: 'kill -TERM $$' });
        expect(result).toBe('Error (killed by SIGTERM): (no output)');
    });

    test('blocks an obviously destructive command before running it', async () => {
        const result = await run(projectDir, 'bash', { command: 'rm -rf /' });
        expect(result).toContain('Error: command blocked by safety policy');
    });

    test('does not inherit stdin, so a command waiting on input does not hang', async () => {
        const result = await run(projectDir, 'bash', { command: 'cat' });
        expect(result).toBe('(no output)');
    });

    test('runs with cwd set to the project root', async () => {
        await Bun.write(join(projectDir, 'marker.txt'), '');
        expect(await run(projectDir, 'bash', { command: 'ls' })).toContain('marker.txt');
    });
});
