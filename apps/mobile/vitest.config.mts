import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The stores are module singletons; keep files from sharing state.
    fileParallelism: false,
  },
});
