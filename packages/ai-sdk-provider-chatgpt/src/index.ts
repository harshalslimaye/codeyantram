/* oxlint-disable eslint/complexity, eslint/max-statements, eslint/max-depth, eslint/max-lines-per-function, eslint/no-magic-numbers, eslint/no-nested-ternary, typescript/strict-boolean-expressions, security/detect-object-injection -- Responses input and SSE events are validated by type and event checks; the protocol mapper retains their ordered branches. */
import {APICallError} from '@ai-sdk/provider';
import type {
  LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult,
  LanguageModelV3FunctionTool, LanguageModelV3StreamPart, LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {z} from 'zod';

const API = 'https://api.openai.com/v1';
const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined},
  outputTokens: {total: undefined, text: undefined, reasoning: undefined},
};

export interface ChatGPTProviderOptions {
  modelSlug: string;
  reasoningEffort?: string;
  getAccessToken: (signal?: AbortSignal) => Promise<string>;
  fetch?: typeof globalThis.fetch;
}

/** Errors created by this adapter contain only fixed, local diagnostic text. */
export class ChatGPTAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatGPTAdapterError';
  }
}

export interface ChatGPTModel {
  slug: string;
  displayName: string;
  contextWindow?: number;
  supportedEffortLevels?: string[];
}

const modelSchema = z.object({
  slug: z.string().min(1), display_name: z.string().optional(), visibility: z.string().optional(),
  supported_in_api: z.boolean().optional(), context_window: z.number().int().positive().optional(),
  supported_reasoning_efforts: z.array(z.string()).optional(),
}).loose();
const catalogSchema = z.object({models: z.array(modelSchema)}).loose();

export async function listChatGPTModels(accessToken: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ChatGPTModel[]> {
  const response = await fetcher(`${API}/models`, {headers: {Authorization: `Bearer ${accessToken}`}, signal});
  if (!response.ok) throw await responseError(response);
  const data = catalogSchema.parse(await response.json());
  return data.models.filter(model => model.visibility === 'list' && model.supported_in_api !== false).map(model => ({
    slug: model.slug, displayName: model.display_name ?? model.slug,
    ...(model.context_window === undefined ? {} : {contextWindow: model.context_window}),
    ...(model.supported_reasoning_efforts === undefined ? {} : {supportedEffortLevels: model.supported_reasoning_efforts}),
  }));
}

export function createChatGPTModel({modelSlug, reasoningEffort, getAccessToken, fetch: fetcher = fetch}: ChatGPTProviderOptions): LanguageModelV3 {
  if (!modelSlug || modelSlug.includes('/') || modelSlug.includes(':')) throw new ChatGPTAdapterError('Invalid ChatGPT model slug.');
  const doStream: LanguageModelV3['doStream'] = async options => {
    const body = encodeRequest(modelSlug, options, reasoningEffort);
    const token = await getAccessToken(options.abortSignal);
    const response = await fetcher(`${API}/responses`, {
      method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: options.abortSignal,
    });
    if (!response.ok) throw await responseError(response);
    if (!response.body) throw new ChatGPTAdapterError('ChatGPT returned no response stream.');
    return {stream: parseResponseStream(response.body), response: {headers: Object.fromEntries(response.headers)}};
  };
  return {
    specificationVersion: 'v3', provider: 'chatgpt', modelId: modelSlug, supportedUrls: {}, doStream,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const {stream} = await doStream(options);
      const content: LanguageModelV3GenerateResult['content'] = [];
      let text = '';
      const reasoning = new Map<string, string>();
      let usage = EMPTY_USAGE;
      let finishReason: LanguageModelV3GenerateResult['finishReason'] | undefined;
      for await (const part of stream) {
        if (part.type === 'text-delta') text += part.delta;
        if (part.type === 'reasoning-delta') reasoning.set(part.id, `${reasoning.get(part.id) ?? ''}${part.delta}`);
        if (part.type === 'tool-call') content.push(part);
        if (part.type === 'error') throw part.error;
        if (part.type === 'finish') {usage = part.usage; finishReason = part.finishReason;}
      }
      if (!finishReason) throw new ChatGPTAdapterError('ChatGPT stream ended without response.completed.');
      if (text) content.unshift({type: 'text', text});
      for (const value of reasoning.values()) content.unshift({type: 'reasoning', text: value});
      return {content, usage, finishReason, warnings: []};
    },
  };
}

function encodeRequest(model: string, options: LanguageModelV3CallOptions, reasoningEffort?: string): Record<string, unknown> {
  for (const key of ['maxOutputTokens', 'temperature', 'topP', 'topK', 'presencePenalty', 'frequencyPenalty', 'seed', 'stopSequences'] as const) {
    if (options[key] !== undefined) throw new ChatGPTAdapterError(`ChatGPT plan requests do not support ${key}.`);
  }
  if (options.responseFormat?.type === 'json') throw new ChatGPTAdapterError('ChatGPT plan structured output is not supported by this adapter.');
  if (options.tools?.some(tool => tool.type !== 'function')) throw new ChatGPTAdapterError('Only local function tools are supported with ChatGPT plan usage.');
  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];
  for (const message of options.prompt) {
    if (message.role === 'system') {instructions.push(message.content); continue;}
    if (message.role === 'user') {
      const content = message.content.map(part => {
        if (part.type !== 'text') throw new ChatGPTAdapterError('Only text input is supported by this ChatGPT provider.');
        return {type: 'input_text', text: part.text};
      });
      input.push({role: 'user', content});
      continue;
    }
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type === 'text') input.push({role: 'assistant', content: part.text});
        else if (part.type === 'tool-call') input.push({type: 'function_call', call_id: part.toolCallId,
          name: part.toolName, arguments: JSON.stringify(part.input), status: 'completed'});
        else if (part.type === 'reasoning') {
          const metadata = part.providerOptions?.chatgpt;
          if (metadata && typeof metadata === 'object' && typeof metadata.encryptedContent === 'string') {
            input.push({type: 'reasoning', encrypted_content: metadata.encryptedContent,
              ...(typeof metadata.itemId === 'string' ? {id: metadata.itemId} : {}),
              summary: part.text ? [{type: 'summary_text', text: part.text}] : []});
          }
        } else throw new ChatGPTAdapterError(`Unsupported assistant content: ${part.type}.`);
      }
      continue;
    }
    for (const part of message.content) {
      if (part.type !== 'tool-result') throw new ChatGPTAdapterError('Unsupported tool content.');
      const output = part.output.type === 'text' || part.output.type === 'error-text' ? part.output.value
        : part.output.type === 'json' || part.output.type === 'error-json' ? JSON.stringify(part.output.value)
          : JSON.stringify(part.output);
      input.push({type: 'function_call_output', call_id: part.toolCallId, output});
    }
  }
  if (options.tools?.length) input.unshift({type: 'additional_tools', role: 'developer', tools: (options.tools as LanguageModelV3FunctionTool[]).map(tool => ({
    type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false,
  }))});
  return {model, input, store: false, stream: true,
    ...(reasoningEffort === undefined ? {} : {reasoning: {effort: reasoningEffort}}),
    ...(instructions.length ? {instructions: instructions.join('\n\n')} : {}),
    ...(options.toolChoice === undefined ? {} : {tool_choice: encodeToolChoice(options.toolChoice)}),
  };
}

function encodeToolChoice(choice: NonNullable<LanguageModelV3CallOptions['toolChoice']>): unknown {
  if (choice.type === 'auto' || choice.type === 'none' || choice.type === 'required') return choice.type;
  if (choice.type === 'tool') return {type: 'function', name: choice.toolName};
  throw new ChatGPTAdapterError('Unsupported ChatGPT tool choice.');
}

async function responseError(response: Response): Promise<Error> {
  let code = '';
  let param: string | undefined;
  let bodyShape = 'other';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (record.error && typeof record.error === 'object') {
        bodyShape = 'error';
        const error = record.error as Record<string, unknown>;
        if (typeof error.code === 'string') code = error.code;
        if (typeof error.param === 'string') param = error.param;
      } else if (typeof record.detail === 'string') bodyShape = 'detail';
    }
  } catch { /* A non-JSON error still carries a useful status. */ }
  return new APICallError({message: `ChatGPT request failed (HTTP ${response.status}${code ? `, ${code}` : ''}).`,
    url: response.url || `${API}/responses`, requestBodyValues: undefined, statusCode: response.status,
    responseHeaders: Object.fromEntries(response.headers), isRetryable: response.status === 503,
    data: {provider: 'chatgpt', code, param, bodyShape,
      requestId: response.headers.get('x-request-id') ?? response.headers.get('openai-request-id') ?? undefined}});
}

function usageFromResponse(value: unknown): LanguageModelV3Usage {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' ? usage.input_tokens_details as Record<string, unknown> : {};
  const outputDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object' ? usage.output_tokens_details as Record<string, unknown> : {};
  const cacheRead = typeof inputDetails.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined;
  const reasoning = typeof outputDetails.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : undefined;
  return {inputTokens: {total: input, noCache: input === undefined ? undefined : input - (cacheRead ?? 0), cacheRead, cacheWrite: undefined},
    outputTokens: {total: output, text: output === undefined ? undefined : output - (reasoning ?? 0), reasoning}};
}

function parseResponseStream(source: ReadableStream<Uint8Array>): ReadableStream<LanguageModelV3StreamPart> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let textStarted = false;
  const textId = 'text-0';
  let toolCalled = false;
  const tools = new Set<string>();
  const reasoningStarted = new Set<string>();
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      controller.enqueue({type: 'stream-start', warnings: []});
      try {
        while (true) {
          const {value, done} = await reader.read();
          buffer += decoder.decode(value, {stream: !done});
          buffer = buffer.replaceAll('\r\n', '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data && data !== '[DONE]') {
              const event: unknown = JSON.parse(data);
              if (event && typeof event === 'object') {
                const entry = event as Record<string, unknown>;
                const response = entry.response && typeof entry.response === 'object' ? entry.response as Record<string, unknown> : {};
                if (entry.type === 'response.created' && typeof response.id === 'string') controller.enqueue({type: 'response-metadata', id: response.id});
                if (entry.type === 'response.output_text.delta' && typeof entry.delta === 'string') {
                  if (!textStarted) {controller.enqueue({type: 'text-start', id: textId}); textStarted = true;}
                  controller.enqueue({type: 'text-delta', id: textId, delta: entry.delta});
                }
                if ((entry.type === 'response.reasoning_summary_text.delta' || entry.type === 'response.reasoning_text.delta') && typeof entry.delta === 'string') {
                  const id = typeof entry.item_id === 'string' ? entry.item_id : 'reasoning-0';
                  if (!reasoningStarted.has(id)) {controller.enqueue({type: 'reasoning-start', id}); reasoningStarted.add(id);}
                  controller.enqueue({type: 'reasoning-delta', id, delta: entry.delta});
                }
                if (entry.type === 'response.output_item.done' && entry.item && typeof entry.item === 'object') {
                  const item = entry.item as Record<string, unknown>;
                  if (item.type === 'reasoning' && typeof item.id === 'string') {
                    if (!reasoningStarted.has(item.id)) controller.enqueue({type: 'reasoning-start', id: item.id});
                    reasoningStarted.delete(item.id);
                    controller.enqueue({type: 'reasoning-end', id: item.id, providerMetadata: {chatgpt: {
                      itemId: item.id, encryptedContent: typeof item.encrypted_content === 'string' ? item.encrypted_content : null,
                    }}});
                  }
                  if (item.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string' && typeof item.arguments === 'string' && !tools.has(item.call_id)) {
                    tools.add(item.call_id); toolCalled = true;
                    controller.enqueue({type: 'tool-call', toolCallId: item.call_id, toolName: item.name, input: item.arguments});
                  }
                }
                if (entry.type === 'response.failed' || entry.type === 'response.incomplete') {
                  const detail = response.error && typeof response.error === 'object' ? response.error as Record<string, unknown> : {};
                  const code = typeof detail.code === 'string' ? detail.code : 'unknown_error';
                  controller.enqueue({type: 'error', error: new APICallError({
                    message: entry.type === 'response.failed' ? `ChatGPT response failed (${code}).` : 'ChatGPT response was incomplete.',
                    url: `${API}/responses`, requestBodyValues: undefined,
                    ...(code === 'subscription_sharing_usage_limit_exceeded' ? {statusCode: 429} : {}),
                    data: {provider: 'chatgpt', code, param: typeof detail.param === 'string' ? detail.param : undefined},
                  })});
                  completed = true;
                }
                if (entry.type === 'error') {
                  const detail = entry.error && typeof entry.error === 'object' ? entry.error as Record<string, unknown> : entry;
                  const code = typeof detail.code === 'string' ? detail.code : 'unknown_error';
                  controller.enqueue({type: 'error', error: new APICallError({
                    message: `ChatGPT stream failed (${code}).`, url: `${API}/responses`, requestBodyValues: undefined,
                    data: {provider: 'chatgpt', code, param: typeof detail.param === 'string' ? detail.param : undefined},
                  })});
                  completed = true;
                }
                if (entry.type === 'response.completed') {
                  completed = true;
                  if (textStarted) controller.enqueue({type: 'text-end', id: textId});
                  for (const id of reasoningStarted) controller.enqueue({type: 'reasoning-end', id});
                  controller.enqueue({type: 'finish', usage: usageFromResponse(response.usage),
                    finishReason: {unified: toolCalled ? 'tool-calls' : 'stop', raw: 'completed'}});
                }
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
          if (done || completed) break;
        }
        if (!completed) throw new ChatGPTAdapterError('ChatGPT stream ended without response.completed.');
        controller.close();
      } catch (error) {controller.error(error);} finally {await reader.cancel().catch(() => {});}
    },
    cancel() {void reader.cancel();},
  });
}
