import {realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';

export const CLI_USAGE = 'Usage: npm run cli -- [init] [--project <directory>]\n\n'
  + '  init                   Build or refresh the project code graph.\n'
  + '  --project <directory>  Select the codebase (defaults to the invocation directory).\n'
  + '  -h, --help             Show this help.\n';

export interface CliOptions {
  command: 'chat' | 'init';
  project?: string;
  help: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {
  const {values, tokens, positionals} = parseArgs({
    args,
    options: {project: {type: 'string'}, help: {type: 'boolean', short: 'h'}},
    strict: true,
    allowPositionals: true,
    tokens: true,
  });
  if (tokens.filter(token => token.kind === 'option' && token.name === 'project').length > 1) {
    throw new Error('--project may only be specified once.');
  }
  if (values.project !== undefined && !values.project.trim()) {
    throw new Error('--project must name a directory.');
  }
  if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== 'init')) {
    throw new Error(`Unknown command: ${positionals.join(' ')}. Use init or omit the command to start chat.`);
  }
  return {command: positionals.length ? 'init' : 'chat', project: values.project, help: values.help ?? false};
}

/** Relative project paths use the caller's directory, even under npm --prefix/workspaces. */
export async function resolveProjectRoot({
  project,
  invocationDirectory = process.env.INIT_CWD,
  cwd = process.cwd(),
}: {project?: string; invocationDirectory?: string; cwd?: string} = {}): Promise<string> {
  const base = (invocationDirectory !== undefined && invocationDirectory.trim() !== '') ? invocationDirectory : cwd;
  const candidate = path.resolve(base, project ?? '.');
  let canonicalRoot: string;
  let isDirectory: boolean;
  try {
    canonicalRoot = await realpath(candidate);
    isDirectory = (await stat(canonicalRoot)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error(`Project directory does not exist: ${candidate}`);
    }
    throw new Error(`Could not access project directory: ${candidate}`);
  }
  if (!isDirectory) throw new Error(`Project path must be a directory: ${candidate}`);
  return canonicalRoot;
}
