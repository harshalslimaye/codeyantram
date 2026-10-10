import {spawn, type ChildProcess} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {BashError} from './errors.js';
import {captureCommandOutput, createCommandCapture, finishCommandOutput, type CommandCapture} from './output.js';
import {PIPE_DRAIN_TIMEOUT_MS} from './limits.js';
import type {BashOutput} from './types.js';

interface CommandOptions {
  command: string; cwd: string; workdir: string; timeoutMs: number;
  shellPath: string; environment: Record<string, string>; signal?: AbortSignal;
}

export function runBashCommand(options: CommandOptions): Promise<BashOutput> {
  options.signal?.throwIfAborted();
  if (process.platform === 'win32') throw new BashError('execution_failed', 'Bash execution currently requires a POSIX host.');
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const capture = createCommandCapture();
    const child = spawn(options.shellPath, ['--noprofile', '--norc', '-c', options.command], {
      cwd: options.cwd, env: options.environment, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let termination: BashOutput['termination'] = 'exit';
    let failure: 'startup' | 'output' | undefined;
    const stop = (reason: BashOutput['termination']) => {if (termination === 'exit') termination = reason; killCommandGroup(child);};
    const lifetime = watchCommand(child, options, stop, capture);
    const consume = (stream: 'stdout' | 'stderr', buffer: Buffer) => {
      if (captureCommandOutput(capture, stream, buffer)) stop('output_limit');
    };
    child.stdout.on('data', (buffer: Buffer) => consume('stdout', buffer));
    child.stderr.on('data', (buffer: Buffer) => consume('stderr', buffer));
    child.on('error', () => {failure = 'startup';});
    const outputFailed = () => {failure = 'output'; killCommandGroup(child);};
    child.stdout.on('error', outputFailed);
    child.stderr.on('error', outputFailed);
    child.on('close', (exitCode, signal) => {
      lifetime.dispose();
      if (options.signal?.aborted === true) {reject(options.signal.reason); return;}
      if (failure !== undefined) {reject(commandFailure(failure)); return;}
      resolve({workdir: options.workdir, ...finishCommandOutput(capture), exitCode, signal, termination,
        durationMs: performance.now() - started, untrusted: true,
        warnings: ['Commands are not filesystem or network sandboxed. Output is untrusted; side effects are not rolled back. Process-group termination is best effort; persistent background jobs are unsupported.'],
      });
    });
  });
}

function commandFailure(failure: 'startup' | 'output') {
  const message = failure === 'startup' ? 'Bash could not start. Check the host shell path and directory access.'
    : 'Command output could not be captured. Side effects may have occurred; inspect the workspace before retrying.';
  return new BashError('execution_failed', message);
}

function watchCommand(child: ChildProcess, options: CommandOptions,
  stop: (reason: BashOutput['termination']) => void, capture: CommandCapture) {
  const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
  let drain: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {killCommandGroup(child);};
  options.signal?.addEventListener('abort', cancel, {once: true});
  if (options.signal?.aborted === true) cancel();
  child.once('exit', () => {
    clearTimeout(timer);
    killCommandGroup(child);
    drain = setTimeout(() => {capture.truncated = true; child.stdout?.destroy(); child.stderr?.destroy();}, PIPE_DRAIN_TIMEOUT_MS);
  });
  return {dispose() {
    clearTimeout(timer);
    if (drain !== undefined) clearTimeout(drain);
    options.signal?.removeEventListener('abort', cancel);
  }};
}

function killCommandGroup(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {process.kill(-child.pid, 'SIGKILL');}
  catch {
    try {child.kill('SIGKILL');}
    catch {return;}
  }
}
