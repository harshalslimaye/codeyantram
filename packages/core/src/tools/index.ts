import {createNavigationExecutor} from './execution.js';
import {createExploreTool} from './explore.js';
import {createGraphTool} from './graph.js';
import {createFindTool} from './find.js';
import {createInspectTool} from './inspect.js';
import {createTraceTool} from './trace.js';
import type {NavigationGraphService} from './types.js';

export {exploreInputSchema} from './explore.js';
export {graphInputSchema} from './graph.js';
export {findInputSchema} from './find.js';
export {inspectInputSchema} from './inspect.js';
export {traceInputSchema} from './trace.js';
export type {NavigationGraphService} from './types.js';

export function createNavigationTools(service: NavigationGraphService) {
  const execute = createNavigationExecutor();
  return {
    explore: createExploreTool(service, execute),
    graph: createGraphTool(service, execute),
    find: createFindTool(service, execute),
    inspect: createInspectTool(service, execute),
    trace: createTraceTool(service, execute),
  };
}
