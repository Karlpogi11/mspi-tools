import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../../../packages/shared-db/src/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
