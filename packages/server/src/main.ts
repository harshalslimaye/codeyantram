import {createApp} from './app.js';

const port = Number(process.env.CODEYANTRAM_PORT ?? 43187);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('CODEYANTRAM_PORT must be an integer between 1 and 65535.');
}

const server = createApp().listen(port, '127.0.0.1', () => {
  process.stdout.write(`Codeyantram server listening at http://127.0.0.1:${port}\n`);
});
server.on('error', error => {
  process.stderr.write(`Could not start the server: ${error.message}\n`);
  process.exitCode = 1;
});

function shutdown() {
  server.close();
  server.closeAllConnections();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
