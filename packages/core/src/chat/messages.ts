import type {ModelMessage} from 'ai';
import {formatContextSummary, type ChatRequest} from '@codeyantram/shared';

/** Historical content stays at user level, separate from trusted instructions. */
export function toModelMessages(request: Pick<ChatRequest, 'messages' | 'contextSummary'>): ModelMessage[] {
  const messages: ModelMessage[] = request.messages.map(message => ({
    role: message.role,
    content: message.parts.map(part => ({type: 'text' as const, text: part.text})),
  }));
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
