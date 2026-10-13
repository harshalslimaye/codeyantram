import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {asObject} from '@codeyantram/shared';

export type ProjectJevThresholds = {retentionThreshold?: number; neighborThreshold?: number};

/** Project settings may tune retention, but cannot enable JEV or supply credentials. */
export async function readProjectJevThresholds(workspaceRoot?: string): Promise<ProjectJevThresholds> {
  if (workspaceRoot === undefined || workspaceRoot === '') return {};
  const filePath = path.join(workspaceRoot, '.codeyantram', 'config.json');
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8'); // oxlint-disable-line security/detect-non-literal-fs-filename -- Read the config under the host workspace root.
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  return parseProjectThresholds(JSON.parse(contents));
}

function parseProjectThresholds(config: unknown): ProjectJevThresholds {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('Project .codeyantram/config.json must contain a JSON object.');
  }
  const settings = asObject(asObject(asObject(config).integrations).jev);
  return {retentionThreshold: validateThreshold(settings.retentionThreshold, 'retentionThreshold'),
    neighborThreshold: validateThreshold(settings.neighborThreshold, 'neighborThreshold')};
}

function validateThreshold(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Project JEV ${name} must be a number from 0 to 1.`);
  }
  return value;
}
