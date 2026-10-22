import { defineConfig } from 'drizzle-kit';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// drizzle-kit resolves `out` relative to the working directory and prefixes
// snapshot paths with "./", so both paths stay relative.
const apiRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  dialect: 'postgresql',
  schema: relative(process.cwd(), `${apiRoot}src/db/schema.ts`),
  out: relative(process.cwd(), `${apiRoot}drizzle`),
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
