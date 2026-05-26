import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['sdk/src/**/*.test.ts', 'lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
