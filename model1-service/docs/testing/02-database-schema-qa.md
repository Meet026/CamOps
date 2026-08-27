# Phase 2 QA: Database Schema

## Test Files

| File | Covers |
|---|---|
| `src/prisma/prisma.service.spec.ts` | The `PrismaService` exposes generated model delegates (e.g. `prisma.department.findMany`), and calls `$connect()` on module init |

## Re-running

```bash
cd model1-service
npm test -- prisma.service.spec.ts
```

## Manual/Integration Checks Performed

- `npx prisma validate` — schema is valid.
- `npx prisma generate` — client generates successfully.
- Confirmed `prisma.department.count()` resolves to `5` against the live `sentinel_model1_db`, matching seed data — verified via a throwaway script, deleted immediately after.
- `diff` confirmed `prisma/schema.prisma` is byte-identical to the repo-root reference schema after reconciliation.
- `/livez` (Phase 3) exercises real database connectivity end-to-end on every call, which is itself a form of continuous integration-level verification of the Prisma connection.

## Result

Database connectivity is real and confirmed, not mocked, for every check above except the unit test (which mocks `PrismaClient` methods, as is correct for a unit test).
