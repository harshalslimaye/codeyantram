import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {GrepError} from './errors.js';
import {MAX_PROCESS_BYTES, MAX_RESULT_BYTES} from './limits.js';
import {parseMatch} from './matches.js';
import type {GrepSearchResult} from './types.js';

interface SearchState extends GrepSearchResult {pending: string; bytes: number; resultBytes: number; stopped: boolean}

function consume(state: SearchState, chunk: string, limit: number) {
  state.pending += chunk;
  let newline = state.pending.indexOf('\n');
  while (newline >= 0 && !state.stopped) {
    const match = parseMatch(state.pending.slice(0, newline));
    state.pending = state.pending.slice(newline + 1);
    if (match === 'unsupported') state.incomplete = true;
    else if (match !== null) appendMatch(state, match, limit);
    newline = state.pending.indexOf('\n');
  }
}

function appendMatch(state: SearchState, match: GrepSearchResult['matches'][number], limit: number) {
  const bytes = Buffer.byteLength(JSON.stringify(match), 'utf8');
  if (state.matches.length >= limit || state.resultBytes + bytes > MAX_RESULT_BYTES) {
    state.truncated = true;
    state.stopped = true;
    return;
  }
  state.matches.push(match);
  state.resultBytes += bytes;
}

export function runRipgrep(root: string, args: string[], limit: number, signal: AbortSignal): Promise<GrepSearchResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const state: SearchState = {matches: [], truncated: false, incomplete: false, warnings: [], pending: '', bytes: 0, resultBytes: 0, stopped: false};
    const child = spawn('rg', args, {cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    const decoder = new StringDecoder('utf8');
    let stderr = '';
    const cancel = () => {child.kill('SIGKILL');};
    signal.addEventListener('abort', cancel, {once: true});
    if (signal.aborted) cancel();
    child.stderr.on('data', (buffer: Buffer) => {stderr = (stderr + buffer.toString('utf8')).slice(0, MAX_RESULT_BYTES);});
    child.stdout.on('data', (buffer: Buffer) => {
      if (state.stopped) return;
      state.bytes += buffer.length;
      try {
        if (state.bytes > MAX_PROCESS_BYTES) {state.stopped = true; state.truncated = true;}
        else consume(state, decoder.write(buffer), limit);
      } catch {state.stopped = true; reject(new GrepError('execution_failed', 'The search backend returned invalid results.'));}
      if (state.stopped) child.kill('SIGKILL');
    });
    child.on('error', () => reject(new GrepError('execution_failed', 'Grep requires ripgrep (rg) installed and available on PATH.')));
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) {reject(signal.reason); return;}
      try {resolve(finishSearch(state, code, stderr));} catch (error) {reject(error);}
    });
  });
}

function finishSearch(state: SearchState, code: number | null, stderr: string): GrepSearchResult {
  if (!state.stopped && code !== 0 && code !== 1) {
    if (/regex parse error|regex compile error|compiled regex exceeds|error parsing glob/.test(stderr)) throw new GrepError('invalid_input', 'Provide a valid ripgrep regex and include glob; PCRE2 is not supported.');
    throw new GrepError('execution_failed', 'Workspace search failed. Check file access and narrow the search path.');
  }
  if (state.incomplete) state.warnings.push('Some matches could not be decoded as UTF-8 text with portable relative paths.');
  if (state.truncated) state.warnings.push('Search reached a result or output budget; narrow the path or pattern.');
  return {matches: state.matches, truncated: state.truncated, incomplete: state.incomplete || state.truncated, warnings: state.warnings};
}
