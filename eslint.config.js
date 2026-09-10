import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // DESIGN.md §15.1: the simulation is a pure module. No renderer, no DOM,
    // no engine dependency. Enforced here as well as in src/sim/purity.test.ts.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['pixi.js', 'pixi.js/*', '@render/*', '**/render/**'],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'The simulation must not touch the DOM (DESIGN.md §15.1).' },
        { name: 'document', message: 'The simulation must not touch the DOM (DESIGN.md §15.1).' },
        {
          name: 'process',
          message: 'The simulation must run unchanged in a browser (DESIGN.md §15.1).',
        },
        {
          name: 'performance',
          message:
            'The simulation is driven by a fixed tick count, not wall time (DESIGN.md §15.1).',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG (src/sim/rng.ts).' },
        {
          object: 'Math',
          property: 'sin',
          message: 'Not bit-identical across platforms; determinism (DESIGN.md §15.1).',
        },
        {
          object: 'Math',
          property: 'cos',
          message: 'Not bit-identical across platforms; determinism (DESIGN.md §15.1).',
        },
        {
          object: 'Math',
          property: 'tan',
          message: 'Not bit-identical across platforms; determinism (DESIGN.md §15.1).',
        },
        {
          object: 'Math',
          property: 'pow',
          message: 'Not bit-identical across platforms; determinism (DESIGN.md §15.1).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The simulation is driven by a fixed tick count, not wall time.',
        },
      ],
    },
  },
);
