import { existsSync, readFileSync } from 'node:fs';

/** Loads a .env file into process.env, skipping any key already set there - a
 * shell-exported var, CI secret, or container env always wins over a file default, the
 * same precedence `dotenv` and Bun's own auto-loading use.
 *
 * Written by hand rather than delegating to either runtime's own env-file support: Bun
 * auto-loads only a *package-local* .env (this repo's lives at the monorepo root, two
 * directories up from packages/server, which is why the old dev/test scripts needed an
 * explicit `--env-file=../../.env` pointer), and Node's `process.loadEnvFile()` (added
 * in Node 20.6) has no Bun equivalent - `typeof process.loadEnvFile` is `undefined`
 * under Bun as of 1.3.x. A parser covering this repo's actual .env.example (plain
 * KEY=VALUE lines, '#' comments, optional quotes) costs less than branching on which
 * runtime-native loader is available, and behaves identically on both. */
export function loadEnvFile(path: string): void {
    if (!existsSync(path)) return;

    for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        if (key === '' || key in process.env) continue;

        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}
