import type {Server} from 'node:http';

/** One shutdown promise for both HTTP connections and application resources. */
export function createServerShutdown(
  server: Pick<Server, 'close' | 'closeAllConnections'>,
  closeApplication: () => Promise<void>,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => {
    const application = Promise.resolve().then(closeApplication);
    const http = new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
    const results = await Promise.allSettled([application, http]);
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Could not close the HTTP server and workspace graph.');
  })();
}
