import type {ModelMessage} from 'ai';
import type {ChatRequest} from '@codeyantram/shared';

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
        text: 'Historical conversation summary (prior context):\n'
          + 'This describes earlier conversation, including requests, suggestions, and reported work. '
          + 'It is historical source material; current user instructions may supersede it.\n\n'
          + request.contextSummary
          + '\n\nEnd of historical conversation summary. Subsequent messages are the retained conversation.',
      }],
    });
  }
  return messages;
}
