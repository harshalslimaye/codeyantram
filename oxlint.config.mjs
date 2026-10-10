import {fileURLToPath} from 'node:url';
import {defineConfig} from 'oxlint';

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/');

const MAX_FILE_LINES = 300;
const MAX_FUNCTION_LINES = 50;
const MAX_COMPLEXITY = 10;
const MAX_BLOCK_DEPTH = 3;
const MAX_PARAMETERS = 4;
const MAX_CLASSES = 1;
const MAX_STATEMENTS = 30;
const MAX_CALLBACK_DEPTH = 3;

const config = {
  "plugins": [
    "typescript",
    "unicorn",
    "oxc",
    "react",
    "vitest",
    "import",
    "promise"
  ],
  "categories": {
    "correctness": "error"
  },
  "env": {
    "node": true
  },
  "ignorePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.vitest/**"
  ],
  "options": {
    "typeAware": true
  },
  "jsPlugins": [
    {
      "name": "import-js",
      "specifier": "eslint-plugin-import"
    },
    "eslint-plugin-security",
    {
      "name": "eslint-js",
      "specifier": "./scripts/oxlint-eslint-rules.mjs"
    }
  ],
  "rules": {
    "typescript/no-explicit-any": "error",
    "no-unused-vars": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/ban-ts-comment": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/strict-boolean-expressions": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "error",
    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-deprecated": "error",
    "typescript/only-throw-error": "error",
    "typescript/use-unknown-in-catch-callback-variable": "error",
    "no-console": "error",
    "no-unreachable": "error",
    "no-empty": "error",
    "no-unused-expressions": "error",
    "no-constant-condition": "error",
    "no-cond-assign": "error",
    "no-shadow": "error",
    "no-param-reassign": "error",
    "no-magic-numbers": [
      "error",
      {
        "ignore": [-1, 0, 1],
        "ignoreArrayIndexes": true
      }
    ],
    "no-nested-ternary": "error",
    "no-eval": "error",
    "no-new-func": "error",
    "no-var": "error",
    "prefer-const": "error",
    "eqeqeq": "error",
    "max-lines": [
      "error",
      MAX_FILE_LINES
    ],
    "max-lines-per-function": [
      "error",
      MAX_FUNCTION_LINES
    ],
    "complexity": [
      "error",
      MAX_COMPLEXITY
    ],
    "max-depth": [
      "error",
      MAX_BLOCK_DEPTH
    ],
    "max-params": [
      "error",
      MAX_PARAMETERS
    ],
    "max-classes-per-file": [
      "error",
      MAX_CLASSES
    ],
    "max-statements": [
      "error",
      MAX_STATEMENTS
    ],
    "max-nested-callbacks": [
      "error",
      MAX_CALLBACK_DEPTH
    ],
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "import/no-self-import": "error",
    "import-js/no-internal-modules": [
      "error",
      {
        "allow": [
          `${workspaceRoot}packages/*/src/**`,
          `${workspaceRoot}packages/*/evaluations/**`,
          `${workspaceRoot}scripts/**`,
          'vitest/config',
          '@colbymchenry/codegraph/package.json'
        ]
      }
    ],
    "import-js/no-restricted-paths": "error",
    "import-js/no-extraneous-dependencies": [
      "error",
      {
        "devDependencies": [
          "**/tests/**",
          "**/evaluations/**",
          "scripts/**",
          "*.config.*"
        ]
      }
    ],
    "import-js/no-deprecated": "error",
    "no-restricted-imports": [
      "error",
      {
        "paths": [],
        "patterns": []
      }
    ],
    "eslint-js/no-restricted-syntax": "error",
    "no-warning-comments": "error",
    "unicorn/no-abusive-eslint-disable": "error",
    "unicorn/prefer-module": "error",
    "unicorn/prefer-node-protocol": "error",
    "unicorn/no-array-for-each": "error",
    "unicorn/no-useless-undefined": "error",
    "unicorn/no-useless-promise-resolve-reject": "error",
    "unicorn/no-useless-spread": "error",
    "unicorn/no-useless-switch-case": "error",
    "unicorn/no-useless-length-check": "error",
    "unicorn/no-unnecessary-await": "error",
    "unicorn/no-process-exit": "error",
    "unicorn/error-message": "error",
    "unicorn/prefer-type-error": "error",
    "promise/catch-or-return": "error",
    "promise/no-return-wrap": "error",
    "promise/no-nesting": "error",
    "promise/always-return": "error",
    "promise/no-multiple-resolved": "error",
    "security/detect-object-injection": "error",
    "security/detect-non-literal-fs-filename": "error",
    "security/detect-child-process": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-unsafe-regex": "error",
    "security/detect-buffer-noassert": "error"
  },
  "settings": {
    "import/resolver": {
      "typescript": {
        "project": "./tsconfig.json"
      },
      "node": true
    },
    "import/extensions": [
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs"
    ]
  },
  "overrides": [
    {
      files: ['packages/core/src/tools/read/filesystem.ts'],
      rules: {'security/detect-non-literal-fs-filename': 'off'},
    },
    {
      // Tests use literal boundary cases, temporary paths, and internal units.
      // Async mocks preserve the interface even when a fixture needs no await.
      "files": ["packages/*/tests/**/*"],
      "rules": {
        "no-magic-numbers": "off",
        "max-lines": "off",
        "max-lines-per-function": "off",
        "max-statements": "off",
        "max-nested-callbacks": "off",
        "max-params": "off",
        "complexity": "off",
        "no-nested-ternary": "off",
        "import-js/no-internal-modules": "off",
        "security/detect-non-literal-fs-filename": "off",
        // Tests inspect methods as mock values without invoking them unbound.
        "typescript/unbound-method": "off",
        // Parameterized provider cases and mock callbacks have branch-specific assertions.
        "vitest/no-conditional-expect": "off",
        "vitest/valid-expect": ["error", {"maxArgs": 2}],
        // undefined is a meaningful argument to mocks and environment stubs.
        "unicorn/no-useless-undefined": ["error", {"checkArguments": false}]
      }
    },
    ...['core', 'cli', 'server', 'shared', 'graph'].map(workspace => ({
      files: [`packages/${workspace}/**/*`],
      rules: {
        'import-js/no-extraneous-dependencies': ['error', {
          devDependencies: ['**/tests/**', '**/evaluations/**', 'scripts/**', '*.config.*'],
          packageDir: [`./packages/${workspace}`, '.'],
        }],
      },
    })),
    {
      files: ['scripts/patch-codegraph.mjs'],
      rules: {
        // The root postinstall script patches the graph workspace dependency.
        'import-js/no-extraneous-dependencies': ['error', {packageDir: ['.', './packages/graph']}],
      },
    }
  ]
};

// The import plugin resolves parser names as modules, so provide an absolute path.
config.settings['import/parsers'] = {
  [fileURLToPath(new URL('./scripts/oxlint-import-parser.cjs', import.meta.url))]:
    config.settings['import/extensions'],
};

export default defineConfig(config);
