import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {streamChat, createJevEvaluator, BashApprover, EvaluationInput, EvaluationQuestions, EvaluationResult, JevEvaluator} from '@codeyantram/core';
import {requireValue} from '../../../shared/tests/helpers.js';

type Evaluate = (input: EvaluationInput<EvaluationQuestions>) => Promise<EvaluationResult<EvaluationQuestions>>;
let directory: string;
let server: Server | undefined;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), 'codeyantram-bash-server-'));});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  await rm(directory, {recursive: true, force: true});
});

describe('server command host capability', () => {
  it.each(['enabled', 'disabled', 'denied', 'no_approver'] as const)('honors host permissions without evaluating commands: %s', async mode => {
    const evaluate = vi.fn<Evaluate>();
    const factory = vi.fn<typeof createJevEvaluator>(() => ({evaluate} as JevEvaluator));
    const approve = vi.fn<BashApprover>(async () => mode !== 'denied');
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'assistant'};
      if (mode === 'no_approver') expect(options.bash).toBeUndefined();
      else {
        const pending = requireValue(options.bash).run({command: 'printf "%s|%s" "$HOST_FLAG" "${PRIVATE_KEY-unset}"'},
          {objective: 'Run tests', abortSignal: options.abortSignal});
        if (mode === 'denied') await expect(pending).rejects.toMatchObject({code: 'permission_denied'});
        else expect(await pending).toMatchObject({stdout: 'permitted|unset', exitCode: 0, termination: 'exit'});
      }
      yield {type: 'done', durationMs: 1};
    });
    const app = createApp({workspaceRoot: directory, streamChat: stream, createJevEvaluator: factory,
      ...(mode !== 'no_approver' ? {approveCommand: approve, commandEnvironment: {HOST_FLAG: 'permitted'}} : {}),
      readConfig: async () => ({providers: {openai: {apiKey: 'PRIVATE KEY'}, typesafe: {apiKey: 'PRIVATE JEV KEY'}}, integrations: {jev: {enabled: mode !== 'disabled'}}}),
    });
    server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP address.');
    const response = await fetch(`http://127.0.0.1:${address.port}/chat`, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Run tests'}]}]}),
    });
    expect(await response.text()).toContain('done');
    expect(approve).toHaveBeenCalledTimes(mode === 'no_approver' ? 0 : 1);
    expect(evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(approve.mock.calls)).not.toContain('PRIVATE KEY');
    expect(await readdir(directory)).toEqual([]);
    expect(app.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    await app.close();
  });
});
