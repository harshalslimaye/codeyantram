import {describe, expect, it} from 'vitest';
import type {JevEvaluator} from '@codeyantram/core';
import {resolveJevCapability} from '../../src/integrations/jev.js';

describe('JEV host configuration', () => {
  it.each([[undefined, 0.2], [0.35, 0.35], [-1, 0.2]] as const)('passes retention threshold %s into the tool capability', (retentionThreshold, expected) => {
    const evaluator: JevEvaluator = {evaluate: async () => {throw new Error('unused');}};
    const capability = resolveJevCapability({providers: {typesafe: {apiKey: 'fixture'}},
      integrations: {jev: {enabled: true, retentionThreshold}}}, new AbortController().signal, () => evaluator);
    expect(capability).toMatchObject({status: 'available', retentionThreshold: expected});
  });
});
