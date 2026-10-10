import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createBashService, createBashTool, createToolExecutor, type BashApprover} from '../../../src/index.js';

let directory: string;
let outside: string;
function setup(approve: BashApprover = async () => true) {
  const permission = vi.fn<BashApprover>(approve);
  return {permission, service: createBashService({workspaceRoot: directory, approve: permission})};
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codeyantram-bash-'));
  outside = await mkdtemp(join(tmpdir(), 'codeyantram-bash-outside-'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, {recursive: true, force: true});
  await rm(outside, {recursive: true, force: true});
});

describe('host-permitted Bash commands', () => {
  it('executes the exact command and reports stdout, stderr, and a nonzero exit independently of tool success', async () => {
    const {service, permission} = setup();
    const command = "printf 'hello'; printf 'failed' >&2; exit 7";
    const result = await service.run({command}, {objective: 'Run targeted tests'});
    expect(result).toMatchObject({workdir: '.', stdout: 'hello', stderr: 'failed', exitCode: 7, signal: null,
      termination: 'exit', truncated: false, untrusted: true});
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty('evaluation');
    expect(permission.mock.calls[0]?.[0]).toEqual({command, workdir: '.', timeoutMs: 30000, objective: 'Run targeted tests'});
  });

  it('runs in a canonical nested workspace directory with stdin closed', async () => {
    await mkdir(join(directory, 'src'));
    const {service} = setup();
    const result = await service.run({command: "read value || printf 'no stdin'; printf 'written' > file.txt", workdir: 'src'});
    expect(result).toMatchObject({workdir: 'src', stdout: 'no stdin', exitCode: 0});
    expect(await readFile(join(directory, 'src/file.txt'), 'utf8')).toBe('written');
  });

  it('denial never starts a command', async () => {
    const {service} = setup(async () => false);
    await expect(service.run({command: 'printf bad > file.txt'})).rejects.toMatchObject({code: 'permission_denied'});
    expect(await readdir(directory)).toEqual([]);
  });

  it('isolates callback mutations from the approved command', async () => {
    const {service} = setup(async request => {request.command = 'printf wrong > wrong'; request.workdir = '/tmp'; return true;});
    await service.run({command: 'printf correct > correct'});
    expect(await readdir(directory)).toEqual(['correct']);
  });

  it('does not inherit provider credentials or read startup scripts, but accepts explicit host environment', async () => {
    vi.stubEnv('PRIVATE_KEY', 'private-provider-key');
    const startup = join(directory, 'startup');
    await writeFile(startup, 'printf leaked > leaked\n');
    const service = createBashService({workspaceRoot: directory, approve: async () => true,
      environment: {HOST_FLAG: 'allowed', BASH_ENV: startup, ENV: startup}});
    const result = await service.run({command: 'printf "%s|%s|%s" "${PRIVATE_KEY-unset}" "$HOST_FLAG" "${BASH_ENV-unset}"'});
    expect(result.stdout).toBe('unset|allowed|unset');
    expect(await readdir(directory)).toEqual(['startup']);
  });

  it('terminates the process group on timeout and prevents a child from writing later', async () => {
    const {service} = setup();
    const result = await service.run({command: '(sleep 0.2; printf leaked > leaked) & wait', timeoutMs: 20});
    expect(result).toMatchObject({termination: 'timeout', signal: 'SIGKILL', exitCode: null});
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(await readdir(directory)).toEqual([]);
  });

  it('cancels a running process group and propagates the caller reason', async () => {
    const {service} = setup();
    const controller = new AbortController();
    const stop = new Error('stop command');
    const pending = service.run({command: '(sleep 0.2; printf leaked > leaked) & printf ready > ready; wait'},
      {abortSignal: controller.signal}).catch((error: unknown) => error);
    await vi.waitFor(async () => expect(await readFile(join(directory, 'ready'), 'utf8')).toBe('ready'));
    controller.abort(stop);
    expect(await pending).toBe(stop);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(await readdir(directory)).toEqual(['ready']);
  });

  it('terminates ordinary background descendants even after a successful shell exit', async () => {
    const {service} = setup();
    const result = await service.run({command: '(sleep 0.2; printf leaked > leaked) & printf done'});
    expect(result).toMatchObject({stdout: 'done', termination: 'exit', exitCode: 0});
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(await readdir(directory)).toEqual([]);
  });

  it('bounds excessive process output and reports why execution was terminated', async () => {
    const {service} = setup();
    const result = await service.run({command: 'yes output', timeoutMs: 5000});
    expect(result).toMatchObject({termination: 'output_limit', truncated: true});
    expect(Buffer.byteLength(result.stdout + result.stderr, 'utf8')).toBeLessThanOrEqual(12000);
  });

  it('fits escaped control characters under the shared tool envelope', async () => {
    const {service} = setup();
    const tool = createBashTool(service, createToolExecutor());
    const result = await tool.execute?.({command: 'head -c 12000 /dev/zero'}, {toolCallId: 'bash', messages: [], context: {}});
    expect(result).toMatchObject({status: 'success', output: {exitCode: 0, truncated: true}});
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(80000);
  });
});

describe('command input and permission boundaries', () => {
  it.each([{command: ''}, {command: '   '}, {command: 'printf\0bad'}, {command: 'x'.repeat(8193)},
    {command: 'true', timeoutMs: 0}, {command: 'true', timeoutMs: 120001}, {command: 'true', timeoutMs: 1.5},
    {command: 'true', workdir: '../outside'}, {command: 'true', workdir: '/tmp'},
    {command: 'true', workspaceRoot: '/tmp'}, {command: 'true', environment: {PATH: '/tmp'}},
    {command: 'true', shellPath: '/other'}, {command: 'true', approve: true}, {command: 'true', evaluate: false}])(
    'rejects invalid or model-selected host controls: %j', async input => {
      const {service, permission} = setup();
      await expect(service.run(input)).rejects.toMatchObject({code: 'invalid_input'});
      expect(permission).not.toHaveBeenCalled();
    });

  it('rejects symlink escapes, missing directories, and file workdirs before permission', async () => {
    await symlink(outside, join(directory, 'escape'));
    await writeFile(join(directory, 'file'), 'text');
    const {service, permission} = setup();
    for (const workdir of ['escape', 'missing', 'file']) await expect(service.run({command: 'true', workdir})).rejects.toBeInstanceOf(Error);
    expect(permission).not.toHaveBeenCalled();
  });

  it('revalidates the approved directory after the host callback', async () => {
    await mkdir(join(directory, 'one'));
    await mkdir(join(directory, 'two'));
    await symlink(join(directory, 'one'), join(directory, 'selected'));
    const {service, permission} = setup(async () => {
      await rm(join(directory, 'selected'));
      await symlink(join(directory, 'two'), join(directory, 'selected'));
      return true;
    });
    await expect(service.run({command: 'printf bad > ran', workdir: 'selected'})).rejects.toMatchObject({code: 'permission_denied'});
    expect(permission.mock.calls[0]?.[0].workdir).toBe('one');
    expect(await readdir(join(directory, 'two'))).toEqual([]);
  });

  it('cancels while awaiting permission without executing after a late approval', async () => {
    const controller = new AbortController();
    const {service} = setup(async () => {controller.abort(new Error('stop approval')); return true;});
    await expect(service.run({command: 'printf bad > ran'}, {abortSignal: controller.signal})).rejects.toThrow('stop approval');
    expect(await readdir(directory)).toEqual([]);
  });

  it('sanitizes startup and host callback failures and shares the tool budget', async () => {
    const missing = createBashService({workspaceRoot: directory, approve: async () => true, shellPath: join(directory, 'private-shell')});
    await expect(missing.run({command: 'true'})).rejects.toMatchObject({code: 'execution_failed',
      message: 'Bash could not start. Check the host shell path and directory access.'});
    const {service} = setup(async () => {throw new Error('PRIVATE KEY');});
    const execute = createToolExecutor();
    const tool = createBashTool(service, execute);
    const result = await tool.execute?.({command: 'true'}, {toolCallId: 'bash', messages: [], context: {}});
    expect(result).toMatchObject({status: 'error', error: {code: 'execution_failed'}});
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
    for (let position = 1; position < 12; position++) await execute('glob', `${position}`, undefined, async () => ({}));
    expect(await execute('bash', 'over', undefined, async () => ({}))).toMatchObject({error: {code: 'tool_limit'}});
  });

  it('requires explicit host configuration and an absolute shell executable', () => {
    expect(() => createBashService({workspaceRoot: '', approve: async () => true})).toThrow('The host must provide');
    expect(() => createBashService({workspaceRoot: directory, approve: async () => true, shellPath: 'bash'})).toThrow('The host shell path must be absolute');
    expect(() => createBashService({workspaceRoot: directory, approve: async () => true, environment: {'bad-key': 'value'}})).toThrow('valid command environment');
  });
});
