import type {GraphReader} from '../contracts/graph.js';

/** Grants a scoped reader and drains all admitted reads, including forgotten awaits. */
export async function withGraphReader<T>(
  graph: GraphReader,
  read: (reader: GraphReader) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let active = true;
  const pending: Promise<unknown>[] = [];
  const check = () => {
    if (!active) throw new Error('Graph readers can only be used inside their query callback.');
    signal?.throwIfAborted();
  };
  const track = <R>(result: Promise<R>): Promise<R> => {
    pending.push(result);
    // Observe fire-and-forget failures until the callback drains.
    void result.catch(() => {});
    return result;
  };
  const reader: GraphReader = {
    search: (...args) => {check(); return graph.search(...args);},
    getSymbol: (...args) => {check(); return graph.getSymbol(...args);},
    getCallers: (...args) => {check(); return graph.getCallers(...args);},
    getCallees: (...args) => {check(); return graph.getCallees(...args);},
    getSource: (...args) => {check(); return track(graph.getSource(...args));},
    explore: (...args) => {check(); return track(graph.explore(...args));},
    find: (...args) => {check(); return track(graph.find(...args));},
    inspect: (...args) => {check(); return track(graph.inspect(...args));},
    trace: (...args) => {check(); return track(graph.trace(...args));},
  };
  try {
    const value = await read(reader);
    active = false;
    await Promise.all(pending);
    signal?.throwIfAborted();
    return value;
  } finally {
    active = false;
    await Promise.allSettled(pending);
  }
}
