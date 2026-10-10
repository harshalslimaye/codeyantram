import queryAst from 'esquery';

const esquery = /** @type {(program: object, selector: string) => object[]} */ (queryAst);

/** @typedef {{options: [(string | {selector: string, message?: string})[]?], report: (report: {node: object, message: string}) => void}} RuleContext */

export default {
  meta: {name: 'codeyantram-eslint-rules'},
  rules: {
    'no-restricted-syntax': {
      meta: {
        type: 'suggestion',
        schema: [{type: 'array', items: {oneOf: [
          {type: 'string'},
          {type: 'object', properties: {
            selector: {type: 'string'},
            message: {type: 'string'},
          }, required: ['selector'], additionalProperties: false},
        ]}}],
        messages: {restricted: 'Do not use {{syntax}}.'},
      },
      /** @param {RuleContext} context */
      create(context) {
        const selectors = context.options[0] ?? [];
        return {
          /** @param {object} program */
          'Program:exit'(program) {
            for (const entry of selectors) {
              const selector = typeof entry === 'string' ? entry : entry.selector;
              for (const node of esquery(program, selector)) {
                context.report({
                  node,
                  message: typeof entry === 'object' && Boolean(entry.message)
                    ? entry.message
                    : 'Do not use this syntax.',
                });
              }
            }
          },
        };
      },
    },
  },
};
