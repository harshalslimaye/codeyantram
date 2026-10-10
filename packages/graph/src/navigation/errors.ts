export class GraphSourceChangedError extends Error {
  constructor() {
    super('Source changed while graph context was being assembled. Retry explore.');
    this.name = 'GraphSourceChangedError';
  }
}

export {GraphNavigationError} from './navigation-error.js';
