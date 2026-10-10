import {createApp} from './app.js';
import {createServerShutdown} from './http/lifecycle.js';

const DEFAULT_PORT = 43187;
const MAX_PORT = 65535;

const port = Number(process.env.CODEYANTRAM_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
  throw new Error('CODEYANTRAM_PORT must be an integer between 1 and 65535.');
}

const app = createApp({workspaceRoot: process.env.INIT_CWD ?? process.cwd()});
const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Codeyantram server listening at http://127.0.0.1:${port}\n`);
});
server.on('error', error => {
  process.stderr.write(`Could not start the server: ${error.message}\n`);
  process.exitCode = 1;
  shutdown();
});

const close = createServerShutdown(server, () => app.close());
let shuttingDown: Promise<void> | undefined;
function shutdown(): void {
  shuttingDown ??= close().catch((error: unknown) => {
    process.stderr.write(`Could not close the server: ${error instanceof Error ? error.message : 'Unknown cleanup error.'}\n`);
    process.exitCode = 1;
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
