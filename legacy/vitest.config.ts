import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
      '@': fileURLToPath(new URL('../apps/web/src', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
