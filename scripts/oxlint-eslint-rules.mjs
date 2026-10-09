import esquery from 'esquery';

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
      create(context) {
        const selectors = context.options[0] ?? [];
        return {
          'Program:exit'(program) {
            for (const entry of selectors) {
              const selector = typeof entry === 'string' ? entry : entry.selector;
              for (const node of esquery(program, selector)) {
                context.report({
                  node,
                  message: typeof entry === 'object' && entry.message
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
