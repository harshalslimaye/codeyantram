import {deadline as evaluationDeadline} from '../../evaluation/cancellation.js';
import {WebFetchError} from './errors.js';

export {abortable} from '../../evaluation/cancellation.js';

export function deadline(milliseconds: number, parent?: AbortSignal) {
  return evaluationDeadline(milliseconds, parent, {
    timeout: () => new WebFetchError('timeout', 'Web fetch timed out.'),
    cancelled: () => new WebFetchError('cancelled', 'Web fetch cancelled.'),
  });
}
