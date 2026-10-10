import {createNavigationExecutor} from '../execution.js';
import {createExploreTool} from './explore.js';
import {createGraphTool} from './graph.js';
import {createFindTool} from './find.js';
import {createInspectTool} from './inspect.js';
import {createTraceTool} from './trace.js';
import type {NavigationGraphService, NavigationEvaluationOptions} from './types.js';
import type {ToolExecutor} from '../types.js';

export {exploreInputSchema} from './explore.js';
export {graphInputSchema} from './graph.js';
export {findInputSchema} from './find.js';
export {inspectInputSchema} from './inspect.js';
export {traceInputSchema} from './trace.js';
export type {NavigationGraphService, NavigationEvaluationOptions, NavigationFilteringMetadata} from './types.js';

export function createNavigationTools(service: NavigationGraphService, execute: ToolExecutor = createNavigationExecutor(), evaluation: NavigationEvaluationOptions = {}) {
  return {
    explore: createExploreTool(service, execute, evaluation),
    graph: createGraphTool(service, execute),
    find: createFindTool(service, execute, evaluation),
    inspect: createInspectTool(service, execute),
    trace: createTraceTool(service, execute),
  };
}
