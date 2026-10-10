import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  // Tables owned by extensions or other tools are never diffed.
  tablesFilter: ['!spatial_ref_sys'],
  schemaFilter: ['public'],
})
