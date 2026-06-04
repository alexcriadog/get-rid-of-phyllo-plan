// Transpile-only variant of jest.config.cjs (isolatedModules: no type-check).
// The full ts-jest type-check OOMs on this machine for targeted runs — use
// `npx tsc --noEmit` for types and this config for fast behavioral specs:
//   npx jest -c jest.lite.config.cjs <pattern> --no-coverage --maxWorkers=1
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.json', isolatedModules: true },
    ],
  },
};
