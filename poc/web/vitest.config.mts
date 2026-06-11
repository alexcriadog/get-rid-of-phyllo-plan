import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['**/__tests__/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    // Mirror tsconfig "@/*" → "./*"
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
});
