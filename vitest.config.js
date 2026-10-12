import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Full reader DOM and real WASM fixtures are memory-heavy. Keep the same
    // bounded concurrency locally and in CI instead of extending test deadlines.
    maxWorkers: 2,
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.js'],
    include: ['tests/unit/**/*.test.js']
  }
})
