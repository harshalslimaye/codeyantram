import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {JevEvaluator} from '@codeyantram/core';
import {readProjectJevThresholds} from '../../src/integrations/project-jev.js';
import {resolveJevCapability} from '../../src/integrations/jev.js';

let workspaceRoot: string;
beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), 'codeyantram-project-jev-'));
  await mkdir(path.join(workspaceRoot, '.codeyantram'));
});
afterEach(async () => {await rm(workspaceRoot, {recursive: true, force: true});});
async function writeProject(config: unknown) {
  await writeFile(path.join(workspaceRoot, '.codeyantram', 'config.json'), JSON.stringify(config));
}

describe('project JEV settings', () => {
  it('overrides neighbor settings independently and preserves global retention settings', async () => {
    await writeProject({integrations: {jev: {neighborThreshold: 0.8}}});
    const thresholds = await readProjectJevThresholds(workspaceRoot);
    const evaluator: JevEvaluator = {evaluate: async () => {throw new Error('unused');}};
    const user = {providers: {typesafe: {apiKey: 'fixture'}}, integrations: {jev: {enabled: true, retentionThreshold: 0.3, neighborThreshold: 0.6}}};
    expect(resolveJevCapability(user, new AbortController().signal, () => evaluator, thresholds))
      .toMatchObject({retentionThreshold: 0.3, neighborThreshold: 0.8});
    expect(resolveJevCapability(user, new AbortController().signal, () => evaluator))
      .toMatchObject({retentionThreshold: 0.3, neighborThreshold: 0.6});
    await writeProject({integrations: {jev: {neighborThreshold: 0}}});
    expect(await readProjectJevThresholds(workspaceRoot)).toMatchObject({neighborThreshold: 0});
  });
  it.each([-1, 2, '0.8', null])('reports invalid project neighbor threshold %s', async neighborThreshold => {
    await writeProject({integrations: {jev: {neighborThreshold}}});
    await expect(readProjectJevThresholds(workspaceRoot)).rejects.toThrow('neighborThreshold must be a number from 0 to 1');
  });
  it('uses a project threshold before the user setting and isolates projects', async () => {
    await writeProject({integrations: {jev: {retentionThreshold: 0.35}}});
    const threshold = await readProjectJevThresholds(workspaceRoot);
    const evaluator: JevEvaluator = {evaluate: async () => {throw new Error('unused');}};
    const user = {providers: {typesafe: {apiKey: 'fixture'}}, integrations: {jev: {enabled: true, retentionThreshold: 0.1}}};
    const capability = resolveJevCapability(user, new AbortController().signal, () => evaluator, threshold);
    expect(capability).toMatchObject({status: 'available', retentionThreshold: 0.35});
    expect(resolveJevCapability(user, new AbortController().signal, () => evaluator)).toMatchObject({retentionThreshold: 0.1});
  });
  it('returns no override for absent project settings', async () => {
    expect(await readProjectJevThresholds()).toEqual({});
    expect(await readProjectJevThresholds(workspaceRoot)).toEqual({});
    await writeProject({integrations: {jev: {enabled: true}}, providers: {typesafe: {apiKey: 'ignored'}}});
    const threshold = await readProjectJevThresholds(workspaceRoot);
    expect(threshold).toEqual({retentionThreshold: undefined, neighborThreshold: undefined});
    expect(resolveJevCapability({}, new AbortController().signal, undefined, threshold)).toEqual({status: 'disabled'});
  });
  it.each([0, 0.2, 1])('accepts project threshold %s and reloads it', async retentionThreshold => {
    await writeProject({integrations: {jev: {retentionThreshold}}});
    expect(await readProjectJevThresholds(workspaceRoot)).toMatchObject({retentionThreshold});
    await writeProject({integrations: {jev: {retentionThreshold: 0.4}}});
    expect(await readProjectJevThresholds(workspaceRoot)).toMatchObject({retentionThreshold: 0.4});
  });
  it.each([-1, 2, '0.2', null])('reports invalid project threshold %s', async retentionThreshold => {
    await writeProject({integrations: {jev: {retentionThreshold}}});
    await expect(readProjectJevThresholds(workspaceRoot)).rejects.toThrow('must be a number from 0 to 1');
  });
  it('reports malformed project files', async () => {
    await writeProject([]);
    await expect(readProjectJevThresholds(workspaceRoot)).rejects.toThrow('must contain a JSON object');
    await writeFile(path.join(workspaceRoot, '.codeyantram', 'config.json'), '{');
    await expect(readProjectJevThresholds(workspaceRoot)).rejects.toBeInstanceOf(SyntaxError);
  });
});
