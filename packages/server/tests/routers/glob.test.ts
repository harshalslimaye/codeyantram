import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {streamChat, createJevEvaluator, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, GlobOutput} from '@codeyantram/core';
import {requireValue} from '../../../shared/tests/helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
let directory: string;
let server: Server | undefined;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-glob-server-'));});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  await rm(directory, {recursive: true, force: true});
});

describe('server workspace glob capability', () => {
  it.each(['enabled', 'disabled', 'bypass'] as const)('binds discovery to the host workspace and honors JEV controls: %s', async mode => {
    for (const name of ['a.ts', 'target.ts', 'z.ts']) await writeFile(join(directory, name), 'PRIVATE SOURCE CONTENT');
    const evaluate = vi.fn<Evaluate>(async () => ({modelId: 'fixture', durationMs: 1, answers: {
      'file-0': {type: 'boolean', probability: 0.1}, 'file-1': {type: 'boolean', probability: 0.9}, 'file-2': {type: 'boolean', probability: 0.01},
    }}));
    const factory = vi.fn<typeof createJevEvaluator>(() => ({evaluate} as JevEvaluator));
    let output: GlobOutput | undefined;
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'assistant'};
      output = await requireValue(options.glob).discover({pattern: '**/*.ts', query: 'Find target', filter: mode !== 'bypass'},
        {objective: 'Host objective', abortSignal: options.abortSignal});
      yield {type: 'done', durationMs: 1};
    });
    const app = createApp({workspaceRoot: directory, streamChat: stream, createJevEvaluator: factory,
      readConfig: async () => ({providers: {openai: {apiKey: 'test'}, typesafe: {apiKey: 'private-key'}}, integrations: {jev: {enabled: mode !== 'disabled'}}}),
    });
    server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP address.');
    const response = await fetch(`http://127.0.0.1:${address.port}/chat`, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Find relevant files'}]}]}),
    });
    expect(await response.text()).toContain('done');
    expect(requireValue(output).files).toEqual(mode === 'enabled' ? ['target.ts', 'a.ts', 'z.ts'] : ['a.ts', 'target.ts', 'z.ts']);
    expect(requireValue(output).filtering.status).toBe(mode === 'enabled' ? 'completed' : 'skipped');
    expect(factory).toHaveBeenCalledTimes(mode === 'disabled' ? 0 : 1);
    if (mode === 'enabled') expect(evaluate.mock.calls[0]?.[0].state).toMatchObject({objective: 'Find target', pattern: '**/*.ts'});
    else expect(evaluate).not.toHaveBeenCalled();
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('private-key');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('PRIVATE SOURCE CONTENT');
    await app.close();
  });
});
