# Spike 04: Prisma for our critical writes

**Question:** can Prisma do the writes that make results exactly-once (R3) and pick the most severe risk,
and does it package cleanly for containers?

**What it is:** the two result tables (D4) in a Prisma schema with an ordered `Risk` enum, plus the
approve statement as TypedSQL (`prisma/sql/approve.sql`). `src/spike.ts` answers three questions.
Run inside `node:22-alpine` against Postgres 16.

**Results (Prisma 7.10.1):**
- Q1, a retried staging write: `createMany({ skipDuplicates: true })` wrote 6 rows, then 0 on retry.
- Q2, `groupBy` with `_max` on the enum: `a.example=MEDIUM, b.example=HIGH, c.example=CRITICAL`. Works.
- Q3, the approve statement (`INSERT … SELECT max(risk) … GROUP BY … ON CONFLICT DO NOTHING`) via
  TypedSQL, run twice: the same 3 rows, correct risks. Typed and idempotent.
- The migration creates `Risk AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL')` in declared order, plus the
  staging primary key and the `(assessment_id, domain)` unique index.
- No native query engine at runtime: Prisma 7 uses the `pg` driver adapter.

**Gotchas found:**
- npm's `latest` tag for the `prisma` CLI was a release candidate (`8.0.0-rc.34`) while
  `@prisma/client` resolved to `7.10.1`. Pin both to the same stable version.
- Prisma 7 needs Node 22.12+. The local Mac had 22.1, so the spike ran in Docker (as the services will).

**Reproduce:** a Postgres on `localhost:15432` (user/password/db `novee`), then
`docker run --rm -v "$PWD":/app -w /app -e DATABASE_URL=postgresql://novee:novee@host.docker.internal:15432/novee node:22-alpine sh -c 'npm i && npx prisma migrate dev --name init && npx prisma generate --sql && npx tsx src/spike.ts'`.
