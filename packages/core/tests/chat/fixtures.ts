export function sseResponse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: {'content-type': 'text/event-stream'},
  });
}

export const openaiEvents = [
  {type: 'response.created', response: {id: 'response-1', created_at: 1, model: 'gpt-6.1-sol'}},
  {type: 'response.output_item.added', output_index: 0, item: {type: 'message', id: 'message-1'}},
  {type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, delta: 'Hello'},
  {type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, delta: ' back'},
  {type: 'response.completed', response: {usage: {
    input_tokens: 10, output_tokens: 3, total_tokens: 13,
    input_tokens_details: {cached_tokens: 4},
  }}},
];

export function openaiToolEvents(name = 'explore', input: unknown = {query: 'greet'}, id = 'call-1') {
  const item = {type: 'function_call', id: `item-${id}`, call_id: id, name, arguments: JSON.stringify(input)};
  return [
    {type: 'response.created', response: {id: `response-${id}`, created_at: 1, model: 'gpt-6.1-sol'}},
    {type: 'response.output_item.added', output_index: 0, item: {...item, arguments: '', status: 'in_progress'}},
    {type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments},
    {type: 'response.output_item.done', output_index: 0, item: {...item, status: 'completed'}},
    {type: 'response.completed', response: {usage: {input_tokens: 5, output_tokens: 3, total_tokens: 8}}},
  ];
}

export function anthropicToolEvents(name = 'explore', input: unknown = {query: 'greet'}, id = 'call-1') {
  return [
    {type: 'message_start', message: {id: 'tool-message', model: 'claude-sonnet-5-5', role: 'assistant', usage: {input_tokens: 5, output_tokens: 0}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'tool_use', id, name, input: {}}},
    {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: JSON.stringify(input)}},
    {type: 'content_block_stop', index: 0},
    {type: 'message_delta', delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 3}},
    {type: 'message_stop'},
  ];
}

export const anthropicEvents = [
  {type: 'message_start', message: {
    id: 'message-1', model: 'claude-sonnet-5-5', role: 'assistant',
    usage: {input_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 1},
  }},
  {type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: ''}},
  {type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: 'Reasoning summary'}},
  {type: 'content_block_stop', index: 0},
  {type: 'content_block_start', index: 1, content_block: {type: 'text', text: ''}},
  {type: 'content_block_delta', index: 1, delta: {type: 'text_delta', text: 'Hello'}},
  {type: 'content_block_delta', index: 1, delta: {type: 'text_delta', text: ' back'}},
  {type: 'content_block_stop', index: 1},
  {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 3}},
  {type: 'message_stop'},
];

export const googleEvents = [
  {candidates: [{content: {role: 'model', parts: [{text: 'Hello'}]}}]},
  {
    candidates: [{content: {role: 'model', parts: [{text: ' back'}]}, finishReason: 'STOP'}],
    usageMetadata: {
      promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13, cachedContentTokenCount: 4,
    },
  },
];

/** Non-streaming HTTP fixtures exercise generateText through the actual adapters. */
export function summaryResponse(model: string, text: string, finish = 'stop'): Response {
  const body = model.startsWith('claude-') ? {
    type: 'message', id: 'summary-1', model, role: 'assistant',
    content: [{type: 'text', text}],
    stop_reason: finish === 'stop' ? 'end_turn' : finish === 'length' ? 'max_tokens' : finish,
    usage: {input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 1},
  } : model.startsWith('gpt-') ? {
    id: 'summary-1', model, created_at: 1,
    output: [{type: 'message', role: 'assistant', id: 'message-1',
      content: [{type: 'output_text', text, annotations: []}]}],
    incomplete_details: finish === 'stop' ? null : {reason: finish === 'length' ? 'max_output_tokens' : finish},
    usage: {input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: {cached_tokens: 4}},
  } : {
    candidates: [{content: {role: 'model', parts: [{text}]},
      finishReason: finish === 'stop' ? 'STOP' : finish === 'length' ? 'MAX_TOKENS' : finish}],
    usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13, cachedContentTokenCount: 4},
  };
  return Response.json(body);
}
