import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'lib/**/*.test.ts', 'components/**/*.test.tsx', 'app/**/*.test.ts'],
  },
})
