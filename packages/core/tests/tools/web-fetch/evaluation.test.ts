import {describe, expect, it} from 'vitest';
import {fetchFixtures} from '../../../evaluations/web-fetch/fixtures.js';
import {selectContent} from '../../../src/tools/web-fetch/selection.js';
import {formatOutput} from '../../../src/tools/web-fetch/output.js';
import type {JevEvaluator} from '../../../src/index.js';

describe('synthetic evidence-retention regressions (oracle judgments)', () => {
  it.each(fetchFixtures)('retains required source evidence for $id', async fixture => {
    const evaluator = {evaluate: async (input: {state: unknown}) => ({modelId: 'oracle', durationMs: 0,
      answers: Object.fromEntries((input.state as {chunks: {id: string; sectionPath: string[]}[]}).chunks.map(chunk => [chunk.id,
        {type: 'boolean', probability: chunk.sectionPath.some(section => fixture.relevantSections.includes(section)) ? 0.95 : 0.01}]))})} as JevEvaluator;
    const url = `https://example.com/${fixture.id}`;
    const selection = await selectContent(fixture.content, url, 'markdown', {jev: {status: 'available', evaluator}, objective: fixture.objective});
    const output = formatOutput({requestedUrl: url, finalUrl: url, status: 200, contentType: 'text/markdown', text: fixture.content}, 'markdown', fixture.content.length, selection);
    for (const evidence of fixture.evidence) expect(output.content, evidence).toContain(evidence);
    expect(output.truncation.truncated).toBe(false);
    expect(output.content.length).toBeLessThan(fixture.content.length);
    expect(output.content).not.toContain('INJECTION_SUCCEEDED');
  });
});
