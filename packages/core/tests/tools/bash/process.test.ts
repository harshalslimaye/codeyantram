import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {runBashCommand} from '../../../src/tools/bash/process.js';

vi.mock('node:child_process', () => ({spawn: vi.fn<typeof spawn>()}));

const options = {command: 'printf exact', cwd: '/workspace/src', workdir: 'src', timeoutMs: 500,
  shellPath: '/bin/bash', environment: {PATH: '/bin'}};
function backend() {
  const child = Object.assign(new EventEmitter(), {pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn<(signal?: string) => boolean>(() => true)});
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(spawn).mockReset();
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});

describe('Bash process lifecycle', () => {
  it('passes the unchanged command as a single Bash argument, with no implicit shell or inherited environment', async () => {
    const child = backend();
    const pending = runBashCommand(options);
    child.stdout.write('stdout');
    child.stderr.write('stderr');
    child.emit('exit', 4, null);
    child.emit('close', 4, null);
    expect(await pending).toMatchObject({stdout: 'stdout', stderr: 'stderr', exitCode: 4, signal: null, termination: 'exit'});
    expect(spawn).toHaveBeenCalledWith('/bin/bash', ['--noprofile', '--norc', '-c', 'printf exact'], {
      cwd: '/workspace/src', env: {PATH: '/bin'}, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills the complete process group at the deadline and cleans its timers', async () => {
    const child = backend();
    const pending = runBashCommand(options);
    await vi.advanceTimersByTimeAsync(500);
    expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    child.emit('exit', null, 'SIGKILL');
    child.emit('close', null, 'SIGKILL');
    expect(await pending).toMatchObject({termination: 'timeout', exitCode: null, signal: 'SIGKILL'});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes inherited pipes after shell exit instead of waiting indefinitely for escaped descendants', async () => {
    const child = backend();
    const pending = runBashCommand(options);
    child.stderr.once('close', () => child.emit('close', 0, null));
    child.stdout.write('prefix');
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({stdout: 'prefix', exitCode: 0, termination: 'exit', truncated: true});
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates cancellation after killing the process group and removes its listener', async () => {
    const child = backend();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = runBashCommand({...options, signal: controller.signal});
    controller.abort(new Error('stop'));
    child.emit('exit', null, 'SIGKILL');
    child.emit('close', null, 'SIGKILL');
    await expect(pending).rejects.toThrow('stop');
    expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes spawn and output-stream errors and does not leave deadline timers', async () => {
    const child = backend();
    const startup = runBashCommand(options);
    child.emit('error', new Error('PRIVATE HOST PATH'));
    child.emit('close', -2, null);
    await expect(startup).rejects.toMatchObject({code: 'execution_failed', message: 'Bash could not start. Check the host shell path and directory access.'});
    const streams = backend();
    const failed = runBashCommand(options);
    streams.stdout.emit('error', new Error('PRIVATE KEY'));
    streams.emit('exit', null, 'SIGKILL');
    streams.emit('close', null, 'SIGKILL');
    await expect(failed).rejects.toMatchObject({code: 'execution_failed',
      message: 'Command output could not be captured. Side effects may have occurred; inspect the workspace before retrying.'});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to direct child termination when process-group signaling fails', async () => {
    vi.mocked(process.kill).mockImplementation(() => {throw new Error('group unavailable');});
    const child = backend();
    const pending = runBashCommand(options);
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await pending;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a failed termination attempt without recursive child-error signaling', async () => {
    vi.mocked(process.kill).mockImplementation(() => {throw new Error('group denied');});
    const child = backend();
    child.kill.mockImplementation(() => {child.emit('error', new Error('kill denied')); return false;});
    const pending = runBashCommand(options);
    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', null, null);
    await expect(pending).rejects.toMatchObject({code: 'execution_failed'});
    expect(vi.getTimerCount()).toBe(0);
  });
});
