/* oxlint-disable eslint/complexity, eslint/max-depth, typescript/no-non-null-assertion, security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex -- The bounded parser and directory reader validate each input before use. */
import {readdir, lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {getUserConfigDirectory} from '@codeyantram/shared';
import {createAgentRegistry, type AgentDiagnostic, type CustomAgentEntry} from '@codeyantram/core';

const MAX_FILES = 64;
const MAX_BYTES = 32_768;
const MAX_FRONTMATTER_LINES = 64;
const MAX_INSTRUCTIONS = 16_000;
const MARKDOWN_EXTENSION_LENGTH = 3;
const FIELDS = new Set(['name', 'description', 'extends', 'tools']);

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
        const definition = parseAgentFile(await readFile(filePath, 'utf8'), `${source}:${name.slice(0, -MARKDOWN_EXTENSION_LENGTH)}`);
        entries.push({source, filePath, definition});
      } catch (error) {
        diagnostics.push({source, filePath, message: error instanceof Error && !('code' in error) ? error.message : 'Could not read agent file.'});
      }
    }
  }
  const registry = createAgentRegistry(entries);
  return {registry, diagnostics: [...diagnostics, ...registry.diagnostics()]};
}

/** Deliberately small YAML subset: plain scalars and one-line or indented string lists. */
export function parseAgentFile(contents: string, id: string): Record<string, unknown> {
  if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error('Agent file exceeds 32 KiB.');
  const lines = contents.replaceAll('\r\n', '\n').split('\n');
  const metadata: Record<string, unknown> = {};
  let bodyStart = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0 || end > MAX_FRONTMATTER_LINES) throw new Error('Invalid agent frontmatter.');
    for (let index = 1; index < end; index++) {
      const line = lines[index]!;
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([a-z]+):(?:\s*(.*))?$/.exec(line);
      if (!match || !FIELDS.has(match[1]!) || Object.hasOwn(metadata, match[1]!)) throw new Error('Invalid, duplicate, or unknown frontmatter field.');
      const key = match[1]!;
      const value = (match[2] ?? '').trim();
      if (key === 'tools') {
        if (value.startsWith('[') && value.endsWith(']')) {
          metadata.tools = value.slice(1, -1).trim() ? value.slice(1, -1).split(',').map(item => plain(item.trim())) : [];
        } else if (!value) {
          const items: string[] = [];
          while (index + 1 < end && /^\s+-\s+/.test(lines[index + 1]!)) items.push(plain(lines[++index]!.replace(/^\s+-\s+/, '').trim()));
          metadata.tools = items;
        } else throw new Error('Malformed tools list.');
      } else metadata[key] = plain(value);
    }
    bodyStart = end + 1;
  }
  const instructions = lines.slice(bodyStart).join('\n').trim();
  if (!instructions || instructions.length > MAX_INSTRUCTIONS) throw new Error('Agent instructions must contain 1–16,000 characters.');
  return {id, ...metadata, instructions};
}

function plain(value: string): string {
  if (!value || /[!&*{}[\]<>`]|^[-?:|>]|\s#/.test(value)) throw new Error('Unsupported frontmatter value.');
  return value.replace(/^(['"])(.*)\1$/, '$2');
}
