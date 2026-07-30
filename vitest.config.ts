import path from 'node:path'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Live-API suite must be opted into explicitly (set by the test:model-provider script);
  // an argv/path heuristic could silently run real API calls with keys auto-loaded from .env
  const isModelProviderRun = process.env.RUN_MODEL_PROVIDER_TESTS === '1'

  return {
    test: {
      globals: true,
      environment: 'node',
      env: {
        ...loadEnv(mode, process.cwd(), ''),
        NODE_ENV: 'test',
      },
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/integration/**/*.{test,spec}.{ts,tsx}'],
      exclude: [
        'node_modules',
        'dist',
        'release',
        '.erb',
        ...(isModelProviderRun ? [] : ['test/integration/model-provider']),
      ],
      setupFiles: [],
      testTimeout: 10000,
      hookTimeout: 10000,
      // Suppress console output in tests
      silent: true,
      logHeapUsage: false,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/renderer'),
        src: path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
  }
})
