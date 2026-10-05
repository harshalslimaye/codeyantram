import {GraphNavigationError} from './errors.js';

export function integer(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GraphNavigationError('invalid_input', `Expected an integer between ${min} and ${max}.`);
  }
  return value;
}

export function budget(value = 12_000): number {return integer(value, 2048, 24_000);}

/** Preserve the low-level lookup/explore validation contract. */
export function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

export function fits(value: unknown, maxCharacters: number): boolean {
  return JSON.stringify(value).length <= maxCharacters;
}

export function requireFits(value: unknown, maxCharacters: number): void {
  if (!fits(value, maxCharacters)) {
    throw new GraphNavigationError('execution_failed', 'Symbol metadata exceeds the context budget. Increase maxCharacters.');
  }
}
