# Phase 2: Database Schema

## What Was Built

Prisma was set up (`prisma/schema.prisma`, `src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`) against the already-existing `sentinel_model1_db` database — this phase did not create any tables.

**Workflow followed:**
1. `npx prisma db pull` introspected the live database.
2. The generated schema (raw snake_case, no `@map` directives) was reconciled to match the hand-maintained reference copy at `../../schema.prisma` (repo root) — verified byte-identical via `diff`.
3. `npx prisma validate` and `npx prisma generate` both succeeded.
4. `PrismaService` (extends `PrismaClient`, implements `OnModuleInit`/`OnModuleDestroy` for connect/disconnect lifecycle) was registered in a `@Global()` `PrismaModule`, so every feature module gets the same single database connection via dependency injection.

**Source of truth:** the actual schema content lives in `prisma/schema.prisma` (this project) and `../../schema.prisma` / `../../model1_fresh_setup.sql` (repo root) — not duplicated here. See `architecture/database-architecture.md` for the table list and purpose summary.

## A Note on Prisma's Version

`prisma`/`@prisma/client` are pinned to `6.19.3`, not the latest major. Newer Prisma versions (7+) reject the `url = env("DATABASE_URL")` datasource syntax the reference schema uses, requiring a different connection-configuration pattern. This is documented in `architecture/database-architecture.md` and flagged as a deliberate compatibility choice, not an oversight.

## Verification

Confirmed live: `prisma.department.count()` resolves to `5`, matching the seed data in `model1_fresh_setup.sql`. Full test coverage in `testing/02-database-schema-qa.md`.
