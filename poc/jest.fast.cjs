// Fast runner: transpile-only (isolatedModules) so ts-jest doesn't type-check
// the whole program per suite (that OOMs this machine — see memory note).
// Type safety is covered separately by `tsc --noEmit`.
const base = require('./jest.config.cjs');
module.exports = {
  ...base,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', isolatedModules: true }],
  },
};
