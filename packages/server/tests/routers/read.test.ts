import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {streamChat, createJevEvaluator, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, ReadOutput} from '@codeyantram/core';
import {requireValue} from '../../../shared/tests/helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
let directory: string;
let server: Server | undefined;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-read-server-'));});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  await rm(directory, {recursive: true, force: true});
});

describe('server workspace read capability', () => {
  it.each([true, false])('binds read to the configured workspace and honors JEV opt-in: %s', async enabled => {
    await writeFile(join(directory, 'source.ts'), 'const evidence = "relevant source";\n'.repeat(200));
    const evaluate = vi.fn<Evaluate>(async input => ({modelId: 'fixture', durationMs: 1,
      answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, {type: 'boolean', probability: 0.9}])),
    }));
    const factory = vi.fn<typeof createJevEvaluator>(() => ({evaluate} as JevEvaluator));
    let output: ReadOutput | undefined;
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'assistant'};
      output = await requireValue(options.read).read({filePath: 'source.ts'}, {objective: 'Find evidence', abortSignal: options.abortSignal});
      yield {type: 'done', durationMs: 1};
    });
    const app = createApp({workspaceRoot: directory, streamChat: stream, createJevEvaluator: factory,
      readConfig: async () => ({providers: {openai: {apiKey: 'test'}, typesafe: {apiKey: 'private-key'}}, integrations: {jev: {enabled}}}),
    });
    server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP address.');
    const response = await fetch(`http://127.0.0.1:${address.port}/chat`, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Find evidence'}]}]}),
    });
    expect(await response.text()).toContain('done');
    expect(requireValue(output).filtering.status).toBe(enabled ? 'completed' : 'skipped');
    expect(evaluate.mock.calls.length > 0).toBe(enabled);
    expect(factory).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('private-key');
    await app.close();
  });
});
