import type {ModelMessage, AssistantContent} from 'ai';
import {formatContextSummary, type ChatRequest} from '@codeyantram/shared';

/** Historical content stays at user level, separate from trusted instructions. */
export function toModelMessages(request: Pick<ChatRequest, 'messages' | 'contextSummary'>): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of request.messages) {
    if (message.role === 'user') {
      messages.push({role: 'user', content: message.parts.map(part => ({type: 'text', text: part.text}))});
      continue;
    }
    let assistant: AssistantContent = [];
    const flush = () => {if (assistant.length) messages.push({role: 'assistant', content: assistant}); assistant = [];};
    for (const part of message.parts) {
      if (part.type === 'text') assistant.push({type: 'text', text: part.text});
      else if (part.type === 'tool-call') assistant.push({type: 'tool-call', ...part.call});
      else {
        flush();
        messages.push({role: 'tool', content: [{type: 'tool-result', toolCallId: part.result.toolCallId,
          toolName: part.result.toolName, output: {type: 'json', value: part.result}}]});
      }
    }
    flush();
  }
  if (request.contextSummary !== undefined) {
    messages.unshift({
      role: 'user',
      content: [{
        type: 'text',
        text: formatContextSummary(request.contextSummary),
      }],
    });
  }
  return messages;
}
