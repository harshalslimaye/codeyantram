/* oxlint-disable eslint/complexity, eslint/max-depth, typescript/no-non-null-assertion, security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex -- The bounded parser and directory reader validate each input before use. */
import {readdir, lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {getUserConfigDirectory, parseAgentMarkdown} from '@codeyantram/shared';
import {createAgentRegistry, type AgentDiagnostic, type CustomAgentEntry} from '@codeyantram/core';

const MAX_FILES = 64;
const MAX_BYTES = 32_768;
const MARKDOWN_EXTENSION_LENGTH = 3;

export async function loadAgentFiles(workspaceRoot?: string, userConfigDirectory = getUserConfigDirectory()) {
  const entries: CustomAgentEntry[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const sources = [
    {source: 'user' as const, directory: path.join(userConfigDirectory, 'agents')},
    ...(workspaceRoot !== undefined && workspaceRoot !== '' ? [{source: 'project' as const, directory: path.join(workspaceRoot, '.codeyantram', 'agents')}] : []),
  ];
  for (const {source, directory} of sources) {
    let names: string[];
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory()) throw new Error('Agent directory is not a regular directory.');
      names = (await readdir(directory)).filter(name => name.endsWith('.md')).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      diagnostics.push({source, filePath: directory, message: 'Could not read agent directory.'});
      continue;
    }
    if (names.length > MAX_FILES) diagnostics.push({source, filePath: directory, message: `Only the first ${MAX_FILES} agent files are loaded.`});
    for (const name of names.slice(0, MAX_FILES)) {
      const filePath = path.join(directory, name);
      try {
        const fileStat = await lstat(filePath);
        if (!fileStat.isFile() || fileStat.size > MAX_BYTES) throw new Error('Agent file must be a regular file under 32 KiB.');
        const resolved = await realpath(filePath);
        if (path.dirname(resolved) !== await realpath(directory)) throw new Error('Agent file leaves its directory.');
        const definition = parseAgentMarkdown(await readFile(filePath, 'utf8'), `${source}:${name.slice(0, -MARKDOWN_EXTENSION_LENGTH)}`);
        entries.push({source, filePath, definition});
      } catch (error) {
        diagnostics.push({source, filePath, message: error instanceof Error && !('code' in error) ? error.message : 'Could not read agent file.'});
      }
    }
  }
  const registry = createAgentRegistry(entries);
  return {registry, diagnostics: [...diagnostics, ...registry.diagnostics()]};
}

export {parseAgentMarkdown as parseAgentFile} from '@codeyantram/shared';
