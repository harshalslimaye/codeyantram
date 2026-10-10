import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {streamChat, createJevEvaluator, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator, GrepOutput} from '@codeyantram/core';
import {requireValue} from '../../../shared/tests/helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
let directory: string;
let server: Server | undefined;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-grep-server-'));});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  await rm(directory, {recursive: true, force: true});
});

describe('server workspace grep capability', () => {
  it.each(['enabled', 'disabled', 'bypass'] as const)('binds grep to the host workspace and honors JEV controls: %s', async mode => {
    await writeFile(join(directory, 'source.ts'), 'needle first\nneedle second\nneedle third');
    const evaluate = vi.fn<Evaluate>(async () => ({modelId: 'fixture', durationMs: 1, answers: {
      'match-0': {type: 'boolean', probability: 0.1}, 'match-1': {type: 'boolean', probability: 0.9}, 'match-2': {type: 'boolean', probability: 0.01},
    }}));
    const factory = vi.fn<typeof createJevEvaluator>(() => ({evaluate} as JevEvaluator));
    let output: GrepOutput | undefined;
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'assistant'};
      output = await requireValue(options.grep).search({pattern: 'needle', query: 'Find second', filter: mode !== 'bypass'},
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
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Find evidence'}]}]}),
    });
    expect(await response.text()).toContain('done');
    expect(requireValue(output).matches.map(match => match.line)).toEqual(mode === 'enabled' ? [2, 1, 3] : [1, 2, 3]);
    expect(requireValue(output).filtering.status).toBe(mode === 'enabled' ? 'completed' : 'skipped');
    expect(factory).toHaveBeenCalledTimes(mode === 'disabled' ? 0 : 1);
    if (mode === 'enabled') expect(evaluate.mock.calls[0]?.[0].state).toMatchObject({objective: 'Find second', pattern: 'needle'});
    else expect(evaluate).not.toHaveBeenCalled();
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('private-key');
    await app.close();
  });
});
