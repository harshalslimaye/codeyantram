import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOL_CATALOG, isReadOnlyTool } from '@codeyantram/shared';
import { buildProjectTools } from '../../src/tools';

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
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', oldText: 'bar', newText: 'qux' });
        expect(result).toBe('Edited a.txt');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo qux baz');
    });

    test('errors, without writing, when oldText is not found', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo bar baz');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', oldText: 'nope', newText: 'x' });
        expect(result).toContain('Error:');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo bar baz');
    });

    test('errors, without writing, when oldText matches more than once', async () => {
        await Bun.write(join(projectDir, 'a.txt'), 'foo foo foo');
        const result = await run(projectDir, 'edit_file', { path: 'a.txt', oldText: 'foo', newText: 'x' });
        expect(result).toContain('Error:');
        expect(result).toContain('3 locations');
        expect(await readFile(join(projectDir, 'a.txt'), 'utf-8')).toBe('foo foo foo');
    });
});

describe('bash', () => {
    test('runs a command in the project root and returns its output', async () => {
        expect(await run(projectDir, 'bash', { command: 'echo hi' })).toBe('hi');
    });

    test('captures a non-zero exit as part of the returned output rather than throwing', async () => {
        const result = await run(projectDir, 'bash', { command: 'exit 1' });
        expect(result).toBe('(no output)');
    });

    test('runs with cwd set to the project root', async () => {
        await Bun.write(join(projectDir, 'marker.txt'), '');
        expect(await run(projectDir, 'bash', { command: 'ls' })).toContain('marker.txt');
    });
});
