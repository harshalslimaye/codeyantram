import {MAX_CAPTURE_BYTES, MAX_CAPTURE_JSON_BYTES, MAX_PROCESS_BYTES} from './limits.js';

interface StreamCapture {buffers: Buffer[]; truncated: boolean}
export interface CommandCapture {
  stdout: StreamCapture;
  stderr: StreamCapture;
  capturedBytes: number;
  totalBytes: number;
  truncated: boolean;
}

export function createCommandCapture(): CommandCapture {
  return {stdout: {buffers: [], truncated: false}, stderr: {buffers: [], truncated: false},
    capturedBytes: 0, totalBytes: 0, truncated: false};
}

export function captureCommandOutput(state: CommandCapture, stream: 'stdout' | 'stderr', buffer: Buffer) {
  state.totalBytes += buffer.length;
  const available = Math.max(0, MAX_CAPTURE_BYTES - state.capturedBytes);
  const retained = buffer.subarray(0, available);
  const capture = stream === 'stdout' ? state.stdout : state.stderr;
  if (retained.length > 0) capture.buffers.push(Buffer.from(retained));
  state.capturedBytes += retained.length;
  if (retained.length < buffer.length) {capture.truncated = true; state.truncated = true;}
  return state.totalBytes > MAX_PROCESS_BYTES;
}

export function finishCommandOutput(state: CommandCapture) {
  const stdout = boundedText(decodeCapture(state.stdout), MAX_CAPTURE_JSON_BYTES);
  const stderr = boundedText(decodeCapture(state.stderr), MAX_CAPTURE_JSON_BYTES - stdout.bytes);
  return {stdout: stdout.text, stderr: stderr.text, truncated: state.truncated || stdout.truncated || stderr.truncated};
}

function decodeCapture(capture: StreamCapture) {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(Buffer.concat(capture.buffers), {stream: capture.truncated});
}

function boundedText(text: string, budget: number) {
  const characters: string[] = [];
  let bytes = 0;
  for (const character of text) {
    const cost = Buffer.byteLength(JSON.stringify(character), 'utf8') - '""'.length;
    if (bytes + cost > budget) return {text: characters.join(''), bytes, truncated: true};
    characters.push(character);
    bytes += cost;
  }
  return {text, bytes, truncated: false};
}
