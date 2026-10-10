import {z} from 'zod';
import {EvaluationError} from './errors.js';
import type {EvaluationInput, EvaluationQuestions} from './types.js';

const MIN_SCORE_CRITERIA = 2;

const MAX_CHOICE_CRITERIA = 255;
const MAX_SCORE_CRITERIA = 10;
const MAX_QUESTION_ID_CHARACTERS = 128;

export const MAX_EVALUATION_QUESTIONS = 64;
export const MAX_EVALUATION_INPUT_BYTES = 1_048_576;

const content = z.union([z.string(), z.array(z.json()), z.record(z.string(), z.json())]);
const description = content.nullable();
const instructions = content.refine(value => typeof value !== 'string' || Boolean(value.trim()));
const question = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('boolean'), instructions,
    criteria: z.strictObject({true: description.optional(), false: description.optional()}).optional(),
  }),
  z.strictObject({
    type: z.literal('choice'), instructions,
    criteria: z.record(z.string().min(1), description).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= MAX_CHOICE_CRITERIA),
  }),
  z.strictObject({type: z.literal('score'), instructions, criteria: z.array(description).min(MIN_SCORE_CRITERIA).max(MAX_SCORE_CRITERIA)}),
]);
const inputSchema = z.strictObject({
  state: content,
  questions: z.record(z.string().min(1).max(MAX_QUESTION_ID_CHARACTERS).refine(id => Boolean(id.trim())), question)
    .refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= MAX_EVALUATION_QUESTIONS),
});

/** Validate and snapshot the input so callers cannot mutate an in-flight request. */
export function parseEvaluationInput<Questions extends EvaluationQuestions>(input: EvaluationInput<Questions>): Pick<EvaluationInput<Questions>, 'state' | 'questions'> {
  try {
    const parsed = inputSchema.parse({state: input.state, questions: input.questions});
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_EVALUATION_INPUT_BYTES) {
      throw new EvaluationError('invalid_input', 'JEV evaluation input exceeds the 1 MiB limit. Submit a smaller batch.');
    }
    return parsed as Pick<EvaluationInput<Questions>, 'state' | 'questions'>;
  } catch (error) {
    if (error instanceof EvaluationError) throw error;
    throw new EvaluationError('invalid_input', 'Provide JSON evaluation state and 1–64 valid Boolean, Choice, or Score questions.');
  }
}

export const confidenceSchema = z.record(z.string(), z.number().min(0).max(1));
