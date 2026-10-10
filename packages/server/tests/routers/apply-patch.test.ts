import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {streamChat, createJevEvaluator, PatchApprover, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator} from '@codeyantram/core';
import {requireValue} from '../../../shared/tests/helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
let directory: string;
let server: Server | undefined;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-patch-server-'));});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  await rm(directory, {recursive: true, force: true});
});

describe('server patch host capability', () => {
  it.each(['enabled', 'disabled', 'denied', 'no_approver'] as const)('requires host approval without evaluating patches even when JEV is enabled: %s', async mode => {
    const evaluate = vi.fn<Evaluate>();
    const factory = vi.fn<typeof createJevEvaluator>(() => ({evaluate} as JevEvaluator));
    const approve = vi.fn<PatchApprover>(async () => mode !== 'denied');
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'assistant'};
      if (mode === 'no_approver') expect(options.applyPatch).toBeUndefined();
      else {
        const run = requireValue(options.applyPatch).apply({patchText: '*** Begin Patch\n*** Add File: file.ts\n+new\n*** End Patch',
          expectedHashes: {}}, {objective: 'Add file', abortSignal: options.abortSignal});
        if (mode === 'denied') await expect(run).rejects.toMatchObject({code: 'permission_denied'});
        else {
          const result = await run;
          expect(result.applied).toHaveLength(1);
          expect(result).not.toHaveProperty('evaluation');
        }
      }
      yield {type: 'done', durationMs: 1};
    });
    const app = createApp({workspaceRoot: directory, streamChat: stream, createJevEvaluator: factory,
      ...(mode !== 'no_approver' ? {approvePatch: approve} : {}),
      readConfig: async () => ({providers: {openai: {apiKey: 'test'}, typesafe: {apiKey: 'PRIVATE KEY'}}, integrations: {jev: {enabled: mode !== 'disabled'}}}),
    });
    server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP address.');
    const response = await fetch(`http://127.0.0.1:${address.port}/chat`, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Add file'}]}]}),
    });
    expect(await response.text()).toContain('done');
    expect(approve).toHaveBeenCalledTimes(mode === 'no_approver' ? 0 : 1);
    expect(evaluate).not.toHaveBeenCalled();
    if (mode !== 'no_approver') expect(approve.mock.calls[0]?.[0]).not.toHaveProperty('evaluation');
    if (mode === 'denied' || mode === 'no_approver') expect(await readdir(directory)).toEqual([]);
    else expect(await readFile(join(directory, 'file.ts'), 'utf8')).toBe('new\n');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('PRIVATE KEY');
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    await app.close();
  });
});
