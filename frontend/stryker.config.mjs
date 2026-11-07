// StrykerJS: tool-generated mutation testing for the frontend unit tests (Vitest).
// Reports go to $STRYKER_OUT (default: reports/mutation). Run: npx stryker run
const out = process.env.STRYKER_OUT ?? 'reports/mutation'

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**', '!src/main.tsx', '!src/types.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: `${out}/stryker.html` },
  jsonReporter: { fileName: `${out}/stryker.json` },
  concurrency: 4,
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
}
