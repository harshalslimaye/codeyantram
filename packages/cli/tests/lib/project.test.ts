import {mkdtemp, mkdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {parseCliOptions, resolveProjectRoot} from '../../src/lib/project.js';

describe('CLI project arguments', () => {
  it('accepts separate and equals forms and preserves spaces in directory names', () => {
    expect(parseCliOptions(['--project', '/some/project with spaces']))
      .toEqual({command: 'chat', project: '/some/project with spaces', help: false});
    expect(parseCliOptions(['--project=../other project']))
      .toEqual({command: 'chat', project: '../other project', help: false});
    expect(parseCliOptions([])).toEqual({command: 'chat', project: undefined, help: false});
  });

  it.each([{args: ['--help']}, {args: ['-h']}])('accepts startup help: $args', ({args}) => {
    expect(parseCliOptions(args)).toEqual({command: 'chat', project: undefined, help: true});
  });

  it('accepts init and project options before or after the command', () => {
    expect(parseCliOptions(['init'])).toEqual({command: 'init', project: undefined, help: false});
    for (const args of [['init', '--project', '../other'], ['--project=../other', 'init']]) {
      expect(parseCliOptions(args)).toEqual({command: 'init', project: '../other', help: false});
    }
    expect(parseCliOptions(['init', '--help'])).toEqual({command: 'init', project: undefined, help: true});
  });

  it.each([
    ['--project'], ['--project='], ['--project', ' \n\t '],
    ['--project', '--help'], ['--project', '/a', '--project=/b'],
    ['--workspace', '/a'], ['--unknown'], ['/a'], ['unknown'], ['init', 'extra'], ['init', 'init'],
  ].map(args => ({args})))('rejects unusable, ambiguous, or unknown arguments: $args', ({args}) => {
    expect(() => parseCliOptions(args)).toThrow(Error);
  });
});

describe('project root resolution', () => {
  let directory: string;
  let caller: string;
  let packageDirectory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-project-'));
    caller = path.join(directory, 'caller');
    packageDirectory = path.join(directory, 'cli-package');
    await mkdir(caller);
    await mkdir(packageDirectory);
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  it('defaults to npm invocation directory instead of the CLI package cwd', async () => {
    expect(await resolveProjectRoot({invocationDirectory: caller, cwd: packageDirectory}))
      .toBe(await realpath(caller));
  });

  it.each(['', ' \t '])('falls back to cwd without a usable npm invocation directory: %j', async invocationDirectory => {
    expect(await resolveProjectRoot({invocationDirectory, cwd: packageDirectory}))
      .toBe(await realpath(packageDirectory));
  });

  it('resolves an explicit relative path against the caller and an absolute path independently', async () => {
    const project = path.join(caller, 'project with spaces');
    await mkdir(project);
    expect(await resolveProjectRoot({project: './project with spaces', invocationDirectory: caller, cwd: packageDirectory}))
      .toBe(await realpath(project));
    expect(await resolveProjectRoot({project, invocationDirectory: packageDirectory, cwd: packageDirectory}))
      .toBe(await realpath(project));
  });

  it('canonicalizes a symlink without changing the process working directory', async () => {
    const alias = path.join(directory, 'alias');
    await symlink(caller, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const cwd = process.cwd();
    expect(await resolveProjectRoot({project: alias, invocationDirectory: caller})).toBe(await realpath(caller));
    expect(process.cwd()).toBe(cwd);
  });

  it('rejects missing directories and regular files', async () => {
    await expect(resolveProjectRoot({project: './missing', invocationDirectory: caller}))
      .rejects.toThrow('Project directory does not exist');
    const file = path.join(caller, 'file.txt');
    await writeFile(file, 'text');
    await expect(resolveProjectRoot({project: file, invocationDirectory: caller}))
      .rejects.toThrow('Project path must be a directory');
  });
});
