import {spawn} from 'node:child_process';

const MAX_PROCESS_BYTES = 8_388_608;
const MAX_RESULT_BYTES = 48_000;

export class RipgrepError extends Error {
  constructor(readonly code: 'invalid_input' | 'execution_failed', message: string) {
    super(message);
    this.name = 'RipgrepError';
  }
}

interface RecordOptions<Record> {
  root: string; args: string[]; limit: number; signal: AbortSignal;
  separator: string; parseRecord: (text: string) => {record: Record} | null | {unsupported: true};
}
export interface RipgrepRecords<Record> {records: Record[]; truncated: boolean; incomplete: boolean}
interface RecordState<Record> extends RipgrepRecords<Record> {pending: string; bytes: number; resultBytes: number; stopped: boolean}

function consume<Record>(state: RecordState<Record>, chunk: string, options: RecordOptions<Record>) {
  state.pending += chunk;
  let boundary = state.pending.indexOf(options.separator);
  while (boundary >= 0 && !state.stopped) {
    const record = options.parseRecord(state.pending.slice(0, boundary));
    state.pending = state.pending.slice(boundary + options.separator.length);
    if (record !== null) {
      if ('unsupported' in record) state.incomplete = true;
      else appendRecord(state, record.record, options.limit);
    }
    boundary = state.pending.indexOf(options.separator);
  }
}

function appendRecord<Record>(state: RecordState<Record>, record: Record, limit: number) {
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  if (state.records.length >= limit || state.resultBytes + bytes > MAX_RESULT_BYTES) {
    state.truncated = true;
    state.stopped = true;
    return;
  }
  state.records.push(record);
  state.resultBytes += bytes;
}

export function runRipgrepRecords<Record>(options: RecordOptions<Record>): Promise<RipgrepRecords<Record>> {
  const {root, args, signal} = options;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const state: RecordState<Record> = {records: [], truncated: false, incomplete: false, pending: '', bytes: 0, resultBytes: 0, stopped: false};
    const child = spawn('rg', args, {cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
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
        else consume(state, decoder.decode(buffer, {stream: true}), options);
      } catch {state.stopped = true; reject(new RipgrepError('execution_failed', 'The search backend returned invalid results.'));}
      if (state.stopped) child.kill('SIGKILL');
    });
    child.on('error', () => reject(new RipgrepError('execution_failed', 'Search requires ripgrep (rg) installed and available on PATH.')));
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) {reject(signal.reason); return;}
      try {
        if (!state.stopped) consume(state, decoder.decode(), options);
        resolve(finishRecords(state, code, stderr));
      } catch (error) {reject(error instanceof RipgrepError ? error : new RipgrepError('execution_failed', 'The search backend returned invalid results.'));}
    });
  });
}

function finishRecords<Record>(state: RecordState<Record>, code: number | null, stderr: string): RipgrepRecords<Record> {
  if (!state.stopped && code !== 0 && code !== 1) {
    if (/regex parse error|regex compile error|compiled regex exceeds|error parsing glob/.test(stderr)) throw new RipgrepError('invalid_input', 'Provide a valid ripgrep pattern.');
    throw new RipgrepError('execution_failed', 'Workspace search failed. Check file access and narrow the search path.');
  }
  if (!state.stopped && state.pending !== '') throw new RipgrepError('execution_failed', 'The search backend returned an incomplete record.');
  return {records: state.records, truncated: state.truncated, incomplete: state.incomplete || state.truncated};
}
