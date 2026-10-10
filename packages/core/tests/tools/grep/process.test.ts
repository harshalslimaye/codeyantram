import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {runRipgrep} from '../../../src/tools/grep/process.js';
import {parseMatch} from '../../../src/tools/grep/matches.js';
import {MAX_PROCESS_BYTES} from '../../../src/tools/grep/limits.js';
import {runRipgrepRecords} from '../../../src/tools/workspace/ripgrep.js';

vi.mock('node:child_process', () => ({spawn: vi.fn<typeof spawn>()}));

function backend() {
  const child = Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn<(signal?: string) => boolean>(() => {queueMicrotask(() => child.emit('close', null)); return true;}),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
function message(text = 'needle', path = 'file.ts', line = 1) {
  return JSON.stringify({type: 'match', data: {path: {text: path}, lines: {text: text + '\n'}, line_number: line, submatches: [{start: 0}]}}) + '\n';
}
beforeEach(() => vi.clearAllMocks());

describe('bounded ripgrep process', () => {
  it('supports NUL-delimited paths including embedded newlines', async () => {
    const child = backend();
    const pending = runRipgrepRecords({root: '/workspace', args: ['--files', '--null'], limit: 10,
      signal: new AbortController().signal, separator: '\0', parseRecord: text => ({record: text})});
    child.stdout.write('line\nbreak.ts\0unsupported\0');
    child.emit('close', 0);
    expect(await pending).toEqual({records: ['line\nbreak.ts', 'unsupported'], truncated: false, incomplete: false});
  });

  it('rejects malformed UTF-8 and incomplete records rather than inventing paths', async () => {
    const child = backend();
    const pending = runRipgrepRecords({root: '/workspace', args: [], limit: 10,
      signal: new AbortController().signal, separator: '\0', parseRecord: text => ({record: text})});
    child.stdout.write(Buffer.from([0xff, 0]));
    await expect(pending).rejects.toMatchObject({code: 'execution_failed'});
    const partial = backend();
    const incomplete = runRipgrepRecords({root: '/workspace', args: [], limit: 10,
      signal: new AbortController().signal, separator: '\0', parseRecord: text => ({record: text})});
    partial.stdout.write('unfinished');
    partial.emit('close', 0);
    await expect(incomplete).rejects.toMatchObject({code: 'execution_failed'});
  });

  it('uses a literal executable, no shell, and streaming UTF-8 decoding', async () => {
    const child = backend();
    const pending = runRipgrep('/workspace', ['--', 'needle', '.'], 10, new AbortController().signal);
    const bytes = Buffer.from(message('🙂 needle'));
    const split = bytes.indexOf(Buffer.from('🙂')) + 1;
    child.stdout.write(bytes.subarray(0, split));
    child.stdout.write(bytes.subarray(split));
    child.emit('close', 0);
    expect(await pending).toMatchObject({matches: [{text: '🙂 needle'}], truncated: false});
    expect(spawn).toHaveBeenCalledWith('rg', ['--', 'needle', '.'], {cwd: '/workspace', shell: false, stdio: ['ignore', 'pipe', 'pipe']});
  });

  it('kills the child when the global result cap is exceeded', async () => {
    const child = backend();
    const pending = runRipgrep('/workspace', [], 1, new AbortController().signal);
    child.stdout.write(message('first') + message('second'));
    expect(await pending).toMatchObject({matches: [{text: 'first'}], truncated: true, incomplete: true});
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('bounds raw process output even when there is no complete JSON frame', async () => {
    const child = backend();
    const pending = runRipgrep('/workspace', [], 10, new AbortController().signal);
    child.stdout.write(Buffer.alloc(MAX_PROCESS_BYTES + 1, 'a'));
    expect(await pending).toMatchObject({matches: [], truncated: true, incomplete: true});
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills in-flight processes on cancellation', async () => {
    const child = backend();
    const controller = new AbortController();
    const pending = runRipgrep('/workspace', [], 10, controller.signal);
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports undecodable matches without manufacturing paths or content', async () => {
    const child = backend();
    const pending = runRipgrep('/workspace', [], 10, new AbortController().signal);
    child.stdout.write(JSON.stringify({type: 'match', data: {path: {bytes: 'YQ=='}}}) + '\n');
    child.emit('close', 0);
    expect(await pending).toMatchObject({matches: [], incomplete: true});
    expect(parseMatch(message('text', '../outside').trim())).toBe('unsupported');
  });

  it('rejects malformed output and does not expose stderr', async () => {
    const child = backend();
    const pending = runRipgrep('/workspace', [], 10, new AbortController().signal);
    child.stdout.write('not JSON\n');
    await expect(pending).rejects.toMatchObject({code: 'execution_failed'});
    const failure = backend();
    const failed = runRipgrep('/workspace', [], 10, new AbortController().signal);
    failure.stderr.write('PRIVATE PATH regex parse error PRIVATE PATTERN');
    failure.emit('close', 2);
    await expect(failed).rejects.toMatchObject({code: 'invalid_input', message: 'Provide a valid ripgrep regex and include glob; PCRE2 is not supported.'});
  });
});
