import {BashError} from './errors.js';

const STARTUP_VARIABLES = new Set(['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE']);

export function commandEnvironment(environment: Record<string, string> = {}): Record<string, string> {
  const entries = Object.entries({PATH: process.env.PATH ?? '/usr/bin:/bin', ...environment});
  if (entries.some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string' || value.includes('\0'))) {
    throw new BashError('invalid_input', 'The host must supply valid command environment names and values.');
  }
  return Object.fromEntries(entries.filter(([name]) => !STARTUP_VARIABLES.has(name)));
}
