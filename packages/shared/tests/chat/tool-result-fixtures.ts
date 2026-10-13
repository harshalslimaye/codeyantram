import type {RequestMessage, ToolResult} from '../../src/index.js';

export const OMITTED_MARKER = 'EXACT_HISTORICAL_DETAIL_7391';
export function readOutput(label = OMITTED_MARKER) {
  return {filePath: 'src/large.ts', contentHash: 'a'.repeat(64), totalLines: 100, offset: 1, nextOffset: null,
    ranges: [{startLine: 1, endLine: 100, text: `${'source context\n'.repeat(400)}${label}\n${'more context\n'.repeat(400)}`}],
    untrusted: true as const, truncation: {truncated: false, lineTruncated: false},
    filtering: {status: 'skipped' as const, reason: 'disabled', totalChunks: 1, evaluatedChunks: 0, retainedChunks: 1, incomplete: false},
    warnings: []};
}

export function readResult(id = 'old-read', label = OMITTED_MARKER): Extract<ToolResult, {status: 'success'}> {
  return {toolCallId: id, toolName: 'read', status: 'success', output: readOutput(label)};
}

export function history(result: ToolResult = readResult()): RequestMessage[] {
  return [
    {id: 'u1', role: 'user', parts: [{type: 'text', text: 'Read the implementation'}]},
    {id: 'a1', role: 'assistant', parts: [
      {type: 'tool-call', call: {toolCallId: result.toolCallId, toolName: result.toolName, input: {filePath: 'src/large.ts'},
        providerOptions: {google: {thoughtSignature: 'historical-signature'}}}},
      {type: 'tool-result', result}, {type: 'text', text: 'File inspected.'},
    ]},
    {id: 'u2', role: 'user', parts: [{type: 'text', text: 'Keep working'}]},
    {id: 'a2', role: 'assistant', parts: [{type: 'text', text: 'Ready'}]},
    {id: 'u3', role: 'user', parts: [{type: 'text', text: 'Explain the earlier finding'}]},
  ];
}
