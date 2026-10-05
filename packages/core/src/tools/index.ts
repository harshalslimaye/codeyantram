import {createNavigationExecutor} from './execution.js';
import {createExploreTool} from './explore.js';
import {createGraphTool} from './graph.js';
import type {NavigationGraphService} from './types.js';

export {exploreInputSchema} from './explore.js';
export {graphInputSchema} from './graph.js';
export type {NavigationGraphService} from './types.js';

export function createNavigationTools(service: NavigationGraphService) {
  const execute = createNavigationExecutor();
  return {
    explore: createExploreTool(service, execute),
    graph: createGraphTool(service, execute),
  };
}
