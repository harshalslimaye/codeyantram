import {expect} from 'vitest';
/** Fail clearly when a fixture, recorded call, or lookup result is missing. */
export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a test fixture value.');
  return value;
}

/** Fixture JSON has a known wire shape; callers supply that shape explicitly. */
export function parseJson<T = unknown>(text: string): T {
  return JSON.parse(text) as T;
}

export function requestBody(body: RequestInit['body']): string {
  if (typeof body !== 'string') throw new Error('Expected a string request body.');
  return body;
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Vitest's asymmetric matchers return any; expected fixture values are opaque. */
export const asymmetric: {
  any: (constructor: unknown) => unknown;
  anything: () => unknown;
  stringContaining: (value: string) => unknown;
  stringMatching: (value: string | RegExp) => unknown;
  objectContaining: (value: unknown) => unknown;
  arrayContaining: (value: unknown[]) => unknown;
} = expect;

export interface WirePart {type?: string; text: string}
export interface ProviderRequest {
  model?: string;
  stream?: boolean;
  input?: {role: string; type?: string; output?: string; content: string | WirePart[]}[];
  messages?: {role: string; content: WirePart[]}[];
  contents?: {role: string; parts: WirePart[]}[];
  tools?: {name: string}[];
  cache_control?: unknown;
  thinking?: unknown;
  output_config?: unknown;
  system?: WirePart[];
  systemInstruction?: {parts: WirePart[]};
  generationConfig?: {maxOutputTokens?: number; thinkingConfig?: unknown};
  max_tokens?: number;
  instructions?: unknown;
}

export interface EvaluationRequest {
  model: string;
  state: {objective: string; chunks: {id: string; sectionPath: string[]}[]};
  questions: Record<string, unknown>;
}

export function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected fixture text.');
  return value;
}

export function requireParts(value: string | WirePart[]): WirePart[] {
  if (typeof value === 'string') throw new Error('Expected fixture content parts.');
  return value;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

export function captureRejection<T>(promise: Promise<T>): Promise<Error> {
  return promise.then(
    () => {throw new Error('Expected the operation to reject.');},
    (reason: unknown) => {
      if (!(reason instanceof Error)) throw new Error('Expected an Error rejection.');
      return reason;
    },
  );
}
