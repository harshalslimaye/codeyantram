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
