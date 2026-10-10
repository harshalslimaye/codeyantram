import {spawn} from 'node:child_process';
import {devNull} from 'node:os';
import {resolveWorkspaceLocation, WorkspacePathError} from '../workspace/paths.js';
import {GitError} from './errors.js';
import {MAX_GIT_ERROR_BYTES, MAX_GIT_OUTPUT_BYTES} from './limits.js';

const GIT_OPTIONS = ['--no-pager', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true',
  '-c', 'diff.external=', '-c', 'core.pager=cat'];

export async function gitWorkspaceRoot(workspaceRoot: string, signal: AbortSignal): Promise<string> {
  let root: string;
  try {({root} = await resolveWorkspaceLocation(workspaceRoot, '.'));}
  catch (error) {
    if (error instanceof WorkspacePathError) throw new GitError('not_found', 'The workspace root could not be found.');
    throw error;
  }
  const result = await runGit(root, ['rev-parse', '--show-prefix'], signal);
  if (result.stdout !== '\n') throw new GitError('invalid_input', 'Git tools require the workspace root to match the repository root.');
  return root;
}

export function runGit(root: string, args: string[], signal: AbortSignal): Promise<{stdout: string; truncated: boolean}> {
  signal.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(environment, {GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_ATTR_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat'});
    const child = spawn('git', [...GIT_OPTIONS, '-C', root, ...args], {
      cwd: root, shell: false, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let stderr = '';
    const cancel = () => child.kill('SIGKILL');
    signal.addEventListener('abort', cancel, {once: true});
    if (signal.aborted) cancel();
    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const remaining = MAX_GIT_OUTPUT_BYTES - bytes;
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) {truncated = true; cancel();}
    });
    child.stderr.on('data', (chunk: Buffer) => {stderr = (stderr + chunk.toString('utf8')).slice(0, MAX_GIT_ERROR_BYTES);});
    child.on('error', () => reject(new GitError('execution_failed', 'Git is not available on the host.')));
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) {reject(signal.reason); return;}
      if (code !== 0 && !truncated) {
        reject(new GitError(stderr.includes('not a git repository') ? 'not_found' : 'execution_failed',
          'The read-only Git command could not complete. Check the repository and arguments.'));
        return;
      }
      resolveResult({stdout: Buffer.concat(chunks).toString('utf8'), truncated});
    });
  });
}
