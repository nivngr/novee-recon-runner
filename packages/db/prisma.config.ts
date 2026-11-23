import { defineConfig } from 'prisma/config';

// DATABASE_URL is read lazily: `prisma generate` runs at image-build time with no database (only
// `migrate` needs it), and Prisma's env() helper would fail the build when it's unset.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
