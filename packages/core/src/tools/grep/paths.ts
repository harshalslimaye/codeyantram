import {resolveWorkspaceLocation, WorkspacePathError} from '../workspace/paths.js';
import {GrepError, mapGrepError} from './errors.js';

export async function searchLocation(workspaceRoot: string, path: string) {
  try {return await resolveWorkspaceLocation(workspaceRoot, path);}
  catch (error) {
    if (error instanceof WorkspacePathError) throw new GrepError(error.code, error.message);
    throw mapGrepError(error);
  }
}
