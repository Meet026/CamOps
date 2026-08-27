# Model 1 Backend — Foundation, Database, Health, Auth (Phases 1-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT CONSTRAINT — READ BEFORE STARTING:** No git repository exists yet, and the user will initialize and manage git themselves. **Never run `git init`, `git add`, or `git commit` during this plan.** Every task ends with "stop and let the user review" instead of a commit step. Do not stage or commit under any circumstances, even if asked to "finish the task" — leave version control entirely to the user.

**Goal:** Stand up the NestJS backend foundation, database connection layer, infrastructure/health endpoints, and authentication + authorization system for Model 1 — a stable, tested skeleton that business modules (camera-registry, integration-scoring, health-monitoring, gis) can be built on top of in later plans.

**Architecture:** NestJS modular monolith (single deployed process, strict module boundaries via dependency injection only). PostgreSQL + PostGIS, accessed through Prisma. JWT access tokens (15 min) + hashed, revocable refresh tokens (7 days) stored in Postgres. Global concerns (versioning, CORS, throttling, correlation IDs, exception filtering) are wired in Phase 1 before any feature code exists.

**Tech Stack:** NestJS 10 (Node.js 24, TypeScript), PostgreSQL 16 + PostGIS (already provisioned as `sentinel_model1_db`), Prisma 5 ORM, `@nestjs/throttler`, `@nestjs/jwt` + `passport-jwt`, `bcrypt`, `class-validator` / `class-transformer`, Jest (unit + e2e, ships with NestJS's default scaffold), npm.

**Spec:** `../../../Model1-PRD.md` (functional requirements, API contract, Section 6a architecture-review addendum) and `../../../Model1-Low-Level-Design.md` (folder structure, internal flows, RBAC design, refresh-token flow) — both at the repo root, two directories above this plan file. The live database schema is `../../../model1_fresh_setup.sql`, already applied to `sentinel_model1_db`.

## Global Constraints

- **Never run `git init`/`git add`/`git commit`.** The user owns all version control for this project.
- Package manager: **npm** only — no yarn/pnpm lockfiles.
- Database name is fixed: `sentinel_model1_db`. Do not create a different database or rename it.
- Never hand-edit `schema.prisma` after the initial `prisma db pull` in Task 3 — from that point on, `npx prisma migrate dev` is the only way to change schema (per PRD Section 6, item on schema source of truth).
- All API routes are served under the `/api/v1` prefix (PRD Section 6a, minor additions).
- CORS must use an explicit origin allowlist from an environment variable — never a wildcard `*` (PRD Section 9).
- Access tokens: 15 minute expiry. Refresh tokens: 7 day expiry, stored as a hash (never plaintext) in the `refresh_token` table (PRD Section 6a point 3, FR-6a).
- Passwords: bcrypt hashes only, never plaintext (PRD Section 9).
- Rate limiting: global default 100 req/min per IP; 5 req/min override on `/auth/login` (PRD Section 6a point 9 — the `/cameras/bulk` override is out of scope for this plan since that module doesn't exist yet; apply it when that module is built).
- Pagination: default page size 25, max 100, `@Max(100)` enforced, reject (400) rather than silently cap (PRD Section 6a point 10). No list endpoints exist yet in this plan, but the shared `PaginationDto` must be built to this spec now since Phase 1 scope includes "Request/response conventions."
- Every unhandled exception must return a consistent JSON shape and never leak a stack trace (PRD Section 9).
- `dept_viewer` role scoping must go through one shared helper (`applyDeptScope`), never ad hoc per-service `WHERE` clauses (PRD Section 6a point 4) — built in this plan's Task 8 since `auth`/`users` already need to reason about roles, even though no scoped queries exist until the camera-registry module.
- Do not implement anything from PRD Section 3 (Non-Goals) or Section 12 (Future Extension Point — Models 2-5) under any circumstances.

---

## File Structure

```
model1-service/
├── .env.example
├── .env                          # gitignored, created locally, not by this plan's steps directly (user fills in real secrets)
├── .gitignore
├── nest-cli.json
├── package.json
├── tsconfig.json
├── docs/
│   ├── MAIN.md
│   ├── 01-backend-foundation.md
│   ├── 02-database-schema.md
│   ├── 03-health-and-infrastructure.md
│   ├── 04-authentication-and-authorization.md
│   ├── testing/
│   │   ├── 01-backend-foundation-qa.md
│   │   ├── 02-database-schema-qa.md
│   │   ├── 03-health-and-infrastructure-qa.md
│   │   └── 04-authentication-and-authorization-qa.md
│   ├── architecture/
│   │   ├── system-architecture.md
│   │   ├── database-architecture.md
│   │   ├── api-architecture.md
│   │   └── security.md
│   └── superpowers/plans/2026-08-25-backend-foundation-phases-1-4.md   # this file
├── prisma/
│   └── schema.prisma             # generated via `prisma db pull`, then hand-annotated to match the reference copy at repo root
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts         # trivial root controller (GET / → service banner), separate from /livez
│   ├── app.service.ts
│   ├── config/
│   │   ├── configuration.ts       # loads/shapes env vars into a typed object
│   │   └── env.validation.ts      # class-validator schema for process.env, fails fast on boot if invalid
│   ├── common/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── middleware/
│   │   │   └── correlation-id.middleware.ts
│   │   ├── interceptors/
│   │   │   └── audit-log.interceptor.ts        # scaffolded now (Phase 1), wired to real audit_log writes in Phase 4 once a User context exists
│   │   ├── dto/
│   │   │   └── pagination.dto.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts
│   │   │   ├── current-user.decorator.ts
│   │   │   └── public.decorator.ts             # marks a route as exempt from the global JwtAuthGuard
│   │   └── scoping/
│   │       └── dept-scope.helper.ts
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts   # GET /livez
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.service.ts
│   │   └── users.service.spec.ts
│   └── auth/
│       ├── auth.module.ts
│       ├── auth.controller.ts
│       ├── auth.controller.spec.ts
│       ├── auth.service.ts
│       ├── auth.service.spec.ts
│       ├── refresh-token.service.ts
│       ├── refresh-token.service.spec.ts
│       ├── dto/
│       │   ├── login.dto.ts
│       │   └── refresh-token.dto.ts
│       └── strategies/
│           └── jwt.strategy.ts
└── test/
    ├── jest-e2e.json
    ├── health.e2e-spec.ts
    └── auth.e2e-spec.ts
```

**Why this shape:** `config/` centralizes environment parsing so nothing else in the codebase calls `process.env` directly. `common/` holds everything cross-cutting (guards, filters, decorators) so feature modules stay focused on their own domain. `prisma/` is a single global module per the PRD's explicit instruction ("do not create a separate database connection per module"). `health/` is deliberately its own tiny module, separate from the future `health-monitoring` business module (camera uptime) — the PRD calls these two different things (`/livez` vs `/health/:cameraId/...`) and conflating their folder names would be confusing later.

---

## Task 1: Scaffold the NestJS Project and Verify It Boots

**Files:**
- Create: `model1-service/` (entire NestJS scaffold via `nest new`)
- Modify: `model1-service/package.json` (add scripts, confirm dependencies)
- Modify: `model1-service/.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a bootable NestJS app on `http://localhost:3000`, `npm run start:dev`, `npm test`, `npm run test:e2e` all runnable from `model1-service/`

- [ ] **Step 1: Scaffold the project**

Run from `/home/meet/Desktop/PA/Model 1/`:

```bash
npx @nestjs/cli new model1-service --package-manager npm --skip-git
```

When prompted for a package manager, confirm `npm`. `--skip-git` is required — this plan must never initialize a git repo.

- [ ] **Step 2: Verify the default app boots**

```bash
cd model1-service
npm run start:dev
```

Expected: console shows `Nest application successfully started`, listening on port 3000. Then in a second terminal:

```bash
curl -s http://localhost:3000
```

Expected: response body `Hello World!`. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 3: Verify the default test suite passes**

```bash
npm test
npm run test:e2e
```

Expected: both report all tests passing (the default scaffold ships one unit test and one e2e test for `AppController`).

- [ ] **Step 4: Confirm `.gitignore` covers secrets and build output**

Read `model1-service/.gitignore` (created by `nest new`) and confirm it already includes `node_modules`, `dist`, and `.env`. If `.env` is missing from it, add this line:

```
.env
```

- [ ] **Step 5: Stop — do not commit**

This task's deliverable is a booting, test-passing default NestJS app. Do not run any git command. Leave the working tree as-is for the user to inspect and commit at their own discretion.

---

## Task 2: Environment Configuration and Validation

**Files:**
- Create: `model1-service/.env.example`
- Create: `model1-service/src/config/env.validation.ts`
- Create: `model1-service/src/config/configuration.ts`
- Create: `model1-service/src/config/env.validation.spec.ts`
- Modify: `model1-service/src/app.module.ts`
- Modify: `model1-service/package.json` (add `@nestjs/config`, `class-validator`, `class-transformer` if not already present)

**Interfaces:**
- Consumes: nothing new
- Produces: `validateEnv(config: Record<string, unknown>): EnvironmentVariables` — throws on invalid/missing required vars; `configuration()` — a factory returning a typed config object, registered as the default NestJS `ConfigModule` loader. Later tasks read config via `ConfigService.get<string>('jwt.secret')` etc., never `process.env` directly.

- [ ] **Step 1: Install config dependencies**

```bash
npm install @nestjs/config class-validator class-transformer
```

- [ ] **Step 2: Write `.env.example`**

Create `model1-service/.env.example`:

```
DATABASE_URL=postgresql://meet:Meet%400326@localhost:5432/sentinel_model1_db

JWT_SECRET=
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=
REFRESH_TOKEN_EXPIRY=7d

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

CORS_ALLOWED_ORIGINS=http://localhost:5173

PORT=3000
NODE_ENV=development
```

This matches PRD Section 13 exactly. `ANTHROPIC_*` and `CLOUDINARY_*` are listed now for completeness (so `.env.example` fully documents what the finished app will need) but are not validated as required in Step 3 below — they're only needed once the `integration-scoring` module is built in a later plan, and requiring them now would block booting the server before that module exists.

- [ ] **Step 3: Write the failing test for env validation**

Create `model1-service/src/config/env.validation.spec.ts`:

```typescript
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRY: '15m',
    REFRESH_TOKEN_SECRET: 'b'.repeat(32),
    REFRESH_TOKEN_EXPIRY: '7d',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    NODE_ENV: 'development',
  };

  it('returns a validated config object when all required vars are present and valid', () => {
    const result = validateEnv(validConfig);
    expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(result.PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when PORT is not a number', () => {
    expect(() => validateEnv({ ...validConfig, PORT: 'not-a-number' })).toThrow();
  });

  it('throws when NODE_ENV is not one of the allowed values', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging-typo' })).toThrow();
  });

  it('defaults NODE_ENV to development when not provided', () => {
    const { NODE_ENV, ...rest } = validConfig;
    const result = validateEnv(rest);
    expect(result.NODE_ENV).toBe('development');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- env.validation.spec.ts`
Expected: FAIL — `Cannot find module './env.validation'`

- [ ] **Step 3: Write `env.validation.ts`**

Create `model1-service/src/config/env.validation.ts`:

```typescript
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRY: string = '15m';

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_SECRET!: string;

  @IsString()
  @IsOptional()
  REFRESH_TOKEN_EXPIRY: string = '7d';

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_MODEL?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_CLOUD_NAME?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_API_KEY?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_API_SECRET?: string;

  @IsString()
  @IsNotEmpty()
  CORS_ALLOWED_ORIGINS!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn([NodeEnv.Development, NodeEnv.Production, NodeEnv.Test])
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- env.validation.spec.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Write `configuration.ts`**

Create `model1-service/src/config/configuration.ts`:

```typescript
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRY ?? '15m',
  },
  refreshToken: {
    secret: process.env.REFRESH_TOKEN_SECRET,
    expiry: process.env.REFRESH_TOKEN_EXPIRY ?? '7d',
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
});
```

- [ ] **Step 6: Wire `ConfigModule` into `app.module.ts`**

Read `model1-service/src/app.module.ts` first (it's the default scaffold output), then replace its contents:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 7: Create a local `.env` and verify the app boots with real config**

```bash
cp .env.example .env
```

Edit `.env` to set real values for `JWT_SECRET` and `REFRESH_TOKEN_SECRET` (any 32+ character random string for local dev, e.g. output of `openssl rand -hex 32`), and confirm `DATABASE_URL` matches the live `sentinel_model1_db` connection string.

```bash
npm run start:dev
```

Expected: boots cleanly with no validation errors. Stop the server once confirmed.

- [ ] **Step 8: Verify boot fails fast on missing required var**

Temporarily rename `.env` to `.env.bak`, run `npm run start:dev` with no `.env` present and no real env vars exported, confirm it throws the "Invalid environment configuration" error and exits non-zero rather than starting with broken config. Restore `.env` from `.env.bak` afterward.

- [ ] **Step 9: Stop — do not commit**

Leave the working tree for the user's own review/commit.

---

## Task 3: Prisma Setup and Schema Introspection

**Files:**
- Create: `model1-service/prisma/schema.prisma` (via `prisma db pull`, then hand-reconciled against the repo-root reference copy)
- Create: `model1-service/src/prisma/prisma.module.ts`
- Create: `model1-service/src/prisma/prisma.service.ts`
- Create: `model1-service/src/prisma/prisma.service.spec.ts`
- Modify: `model1-service/src/app.module.ts`

**Interfaces:**
- Consumes: `ConfigService` (from Task 2) for `database.url`
- Produces: `PrismaService` — extends `PrismaClient`, exposes all generated model delegates (`prisma.department`, `prisma.camera`, etc.) plus lifecycle hooks; injectable anywhere via Nest DI. `PrismaModule` is `@Global()` so no feature module needs to re-import it.

- [ ] **Step 1: Install Prisma**

```bash
npm install prisma --save-dev
npm install @prisma/client
```

- [ ] **Step 2: Initialize Prisma pointing at the existing database**

```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` (a stub) and a root `.env` reference — since `.env` already exists from Task 2, confirm `prisma init` didn't overwrite your real values (it may append a `DATABASE_URL` line; if so, remove the duplicate and keep the one already set correctly).

- [ ] **Step 3: Introspect the live database**

```bash
npx prisma db pull
```

Expected output includes `Introspected 9 models and wrote them into prisma/schema.prisma`, plus warnings about `location_geo` being `Unsupported("geography")` and about CHECK constraints not becoming native enums — both are expected per PRD Section 6's "Known introspection caveat." Do not attempt to fix these warnings; they're documented, accepted behavior.

- [ ] **Step 4: Reconcile the generated schema against the reference copy**

The freshly-pulled schema will have snake_case model/field names (e.g. `model camera { camera_id ... }`) with no `@map` directives, because raw introspection doesn't rename anything. Open the reference file at `/home/meet/Desktop/PA/Model 1/schema.prisma` (repo root — already hand-maintained with camelCase models, `@map()` directives, relation names, and doc comments reflecting every Section 6a decision) and replace the freshly pulled `model1-service/prisma/schema.prisma` with that reference file's content, changing only the `datasource`/`generator` blocks if `prisma init` produced different formatting there. Keep the `datasource db { url = env("DATABASE_URL") }` and `generator client { provider = "prisma-client-js" }` blocks from the newly-initialized file if they differ cosmetically from the reference copy — the model definitions are what must match exactly.

- [ ] **Step 5: Validate and generate the client**

```bash
npx prisma validate
npx prisma generate
```

Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client`.

- [ ] **Step 6: Write the failing test for `PrismaService`**

Create `model1-service/src/prisma/prisma.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('exposes the department model delegate', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    const service = moduleRef.get(PrismaService);
    expect(service.department).toBeDefined();
    expect(typeof service.department.findMany).toBe('function');
  });

  it('connects to the database on module init', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    const service = moduleRef.get(PrismaService);
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- prisma.service.spec.ts`
Expected: FAIL — `Cannot find module './prisma.service'`

- [ ] **Step 8: Write `prisma.service.ts`**

Create `model1-service/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 9: Write `prisma.module.ts`**

Create `model1-service/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- prisma.service.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 11: Wire `PrismaModule` into `app.module.ts`**

Modify `model1-service/src/app.module.ts` — add the import:

```typescript
import { PrismaModule } from './prisma/prisma.module';
```

And add `PrismaModule` to the `imports` array, after `ConfigModule.forRoot(...)`.

- [ ] **Step 12: Verify the app still boots and can reach the database**

```bash
npm run start:dev
```

Expected: no connection errors in the console. In a second terminal, temporarily add a throwaway log line inside `AppService` (or use a REPL) to confirm `prisma.department.count()` resolves to `5` (matching the seed data) — this is a manual sanity check, not a permanent code change. Revert any throwaway line added for this check.

- [ ] **Step 13: Stop — do not commit**

---

## Task 4: Correlation ID Middleware and Global HTTP Exception Filter

**Files:**
- Create: `model1-service/src/common/middleware/correlation-id.middleware.ts`
- Create: `model1-service/src/common/middleware/correlation-id.middleware.spec.ts`
- Create: `model1-service/src/common/filters/http-exception.filter.ts`
- Create: `model1-service/src/common/filters/http-exception.filter.spec.ts`
- Modify: `model1-service/src/app.module.ts`
- Modify: `model1-service/src/main.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: every request gains `req.correlationId` (a UUID, reused from an incoming `x-correlation-id` header if present) and an `x-correlation-id` response header; every uncaught exception (HttpException or otherwise) is serialized as `{ statusCode, message, error, correlationId }` with no stack trace ever included in the response body.

- [ ] **Step 1: Install `uuid`**

```bash
npm install uuid
npm install --save-dev @types/uuid
```

- [ ] **Step 2: Write the failing test for the correlation ID middleware**

Create `model1-service/src/common/middleware/correlation-id.middleware.spec.ts`:

```typescript
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { Request, Response } from 'express';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
  });

  function makeReqRes(headers: Record<string, string> = {}) {
    const req = { headers } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    return { req, res, setHeader };
  }

  it('generates a new correlation ID when none is provided', () => {
    const { req, res, setHeader } = makeReqRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect((req as any).correlationId).toEqual(expect.any(String));
    expect((req as any).correlationId.length).toBeGreaterThan(0);
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', (req as any).correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('reuses an incoming x-correlation-id header instead of generating a new one', () => {
    const { req, res, setHeader } = makeReqRes({ 'x-correlation-id': 'existing-id-123' });
    const next = jest.fn();

    middleware.use(req, res, next);

    expect((req as any).correlationId).toBe('existing-id-123');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'existing-id-123');
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- correlation-id.middleware.spec.ts`
Expected: FAIL — `Cannot find module './correlation-id.middleware'`

- [ ] **Step 4: Write `correlation-id.middleware.ts`**

Create `model1-service/src/common/middleware/correlation-id.middleware.ts`:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare module 'express' {
  interface Request {
    correlationId: string;
  }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-correlation-id'];
    const correlationId = typeof incoming === 'string' && incoming.length > 0 ? incoming : uuidv4();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    next();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- correlation-id.middleware.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 6: Write the failing test for the exception filter**

Create `model1-service/src/common/filters/http-exception.filter.spec.ts`:

```typescript
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  function makeHost(correlationId = 'test-correlation-id') {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const getResponse = jest.fn().mockReturnValue({ status });
    const getRequest = jest.fn().mockReturnValue({ correlationId });
    const host = {
      switchToHttp: () => ({ getResponse, getRequest }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it('formats an HttpException with its own status code and message', () => {
    const { host, status, json } = makeHost();
    const exception = new BadRequestException('latitude must be between -90 and 90');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'latitude must be between -90 and 90',
        correlationId: 'test-correlation-id',
      }),
    );
  });

  it('formats an unknown thrown error as a 500 without leaking its stack trace', () => {
    const { host, status, json } = makeHost();
    const exception = new Error('database connection pool exhausted at internal-host:5432');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = json.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.message).toBe('Internal server error');
    expect(JSON.stringify(payload)).not.toContain('internal-host');
    expect(payload).not.toHaveProperty('stack');
  });

  it('includes the correlation ID from the request even on a generic error', () => {
    const { host, json } = makeHost('abc-123');
    filter.catch(new Error('boom'), host);
    expect(json.mock.calls[0][0].correlationId).toBe('abc-123');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- http-exception.filter.spec.ts`
Expected: FAIL — `Cannot find module './http-exception.filter'`

- [ ] **Step 8: Write `http-exception.filter.ts`**

Create `model1-service/src/common/filters/http-exception.filter.ts`:

```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request?.correlationId;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        message = (bodyObj.message as string | string[]) ?? exception.message;
        error = (bodyObj.error as string) ?? error;
      }
      if (statusCode >= 500) {
        error = 'Internal Server Error';
      } else {
        error = HttpStatus[statusCode] ?? error;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception [${correlationId}]: ${exception.message}`,
        exception.stack,
      );
    }

    const responseBody: ErrorResponseBody = {
      statusCode,
      message,
      error,
      correlationId,
    };

    response.status(statusCode).json(responseBody);
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- http-exception.filter.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 10: Wire both into the application in `main.ts`**

Read `model1-service/src/main.ts` (default scaffold), then replace its contents:

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1', {
    exclude: ['livez'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const allowedOrigins = configService.get<string[]>('cors.allowedOrigins') ?? [];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
}
bootstrap();
```

Note: `/livez` is excluded from the `/api/v1` prefix per PRD Section 8 API contract table, which lists it as a bare route for load-balancer probes.

- [ ] **Step 11: Wire the correlation ID middleware in `app.module.ts`**

Modify `model1-service/src/app.module.ts` to implement `NestModule` and apply the middleware to all routes:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 12: Manually verify the exception filter's response shape end-to-end**

```bash
npm run start:dev
```

In a second terminal:

```bash
curl -i http://localhost:3000/api/v1/this-route-does-not-exist
```

Expected: HTTP 404, JSON body with `statusCode`, `message`, `error`, and a `correlationId` field populated with a UUID, and an `x-correlation-id` response header present. Stop the server once confirmed.

- [ ] **Step 13: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions from earlier tasks.

- [ ] **Step 14: Stop — do not commit**

---

## Task 5: Rate Limiting (Throttler)

**Files:**
- Modify: `model1-service/src/app.module.ts`
- Create: `model1-service/src/common/filters/http-exception.filter.spec.ts` (already exists — no change needed here, listed for context only)
- Test: `model1-service/test/throttler.e2e-spec.ts`

**Interfaces:**
- Consumes: `ConfigModule` (already global from Task 2)
- Produces: a global `ThrottlerGuard` enforcing 100 req/min per IP by default; per-route override capability via `@Throttle()` decorator, used later by the `auth` module's login endpoint (Task 9) for the 5 req/min override.

- [ ] **Step 1: Install `@nestjs/throttler`**

```bash
npm install @nestjs/throttler
```

- [ ] **Step 2: Write the failing e2e test for default throttling**

Create `model1-service/test/throttler.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Throttling (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests under the global limit', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/');
    expect(response.status).not.toBe(429);
  });

  it('returns 429 after exceeding the global per-minute limit on a single route', async () => {
    const requests = Array.from({ length: 105 }, () =>
      request(app.getHttpServer()).get('/api/v1/'),
    );
    const responses = await Promise.all(requests);
    const tooManyRequests = responses.filter((r) => r.status === 429);
    expect(tooManyRequests.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- throttler.e2e-spec.ts`
Expected: FAIL — all requests succeed, no 429 responses, because no throttler is wired yet.

- [ ] **Step 3: Wire `ThrottlerModule` into `app.module.ts`**

Modify `model1-service/src/app.module.ts`:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- throttler.e2e-spec.ts`
Expected: PASS, both tests green. (The 105-request burst test may take a few seconds — that's expected.)

- [ ] **Step 5: Run the full test suite for regressions**

```bash
npm test
npm run test:e2e
```

Expected: all green, no regressions.

- [ ] **Step 6: Stop — do not commit**

---

## Task 6: Shared Pagination DTO

**Files:**
- Create: `model1-service/src/common/dto/pagination.dto.ts`
- Create: `model1-service/src/common/dto/pagination.dto.spec.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `PaginationDto` — `{ page?: number, limit?: number }` with `page` defaulting to `1` and `limit` defaulting to `25`, max `100`; a validation failure on `limit > 100` throws (400) rather than clamping. Later modules extend this via `class extends PaginationDto` for their own query DTOs (e.g. `CameraQueryDto`).

- [ ] **Step 1: Write the failing test**

Create `model1-service/src/common/dto/pagination.dto.spec.ts`:

```typescript
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationDto } from './pagination.dto';

describe('PaginationDto', () => {
  it('defaults page to 1 and limit to 25 when not provided', async () => {
    const dto = plainToInstance(PaginationDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(25);
  });

  it('accepts a valid page and limit', async () => {
    const dto = plainToInstance(PaginationDto, { page: '2', limit: '50' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('rejects a limit greater than 100', async () => {
    const dto = plainToInstance(PaginationDto, { limit: '101' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('rejects a page less than 1', async () => {
    const dto = plainToInstance(PaginationDto, { page: '0' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('rejects a non-integer limit', async () => {
    const dto = plainToInstance(PaginationDto, { limit: '25.5' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pagination.dto.spec.ts`
Expected: FAIL — `Cannot find module './pagination.dto'`

- [ ] **Step 3: Write `pagination.dto.ts`**

Create `model1-service/src/common/dto/pagination.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pagination.dto.spec.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Task 7: `/livez` Liveness Endpoint

**Files:**
- Create: `model1-service/src/health/health.module.ts`
- Create: `model1-service/src/health/health.controller.ts`
- Create: `model1-service/src/health/health.controller.spec.ts`
- Test: `model1-service/test/health.e2e-spec.ts`
- Modify: `model1-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (from Task 3) to confirm DB connectivity
- Produces: `GET /livez` → `200 { status: 'ok', database: 'ok', timestamp: string }` when healthy, `503 { status: 'error', database: 'unreachable', timestamp: string }` when the DB is unreachable. No auth required (this route is public and excluded from the `/api/v1` prefix, per Task 4 Step 10 and PRD Section 8).

- [ ] **Step 1: Write the failing unit test**

Create `model1-service/src/health/health.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('returns ok status when the database responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('ok');
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('throws a 503 when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- health.controller.spec.ts`
Expected: FAIL — `Cannot find module './health.controller'`

- [ ] **Step 3: Write `health.controller.ts`**

Create `model1-service/src/health/health.controller.ts`:

```typescript
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

interface HealthCheckResult {
  status: 'ok' | 'error';
  database: 'ok' | 'unreachable';
  timestamp: string;
}

@Controller('livez')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

Note: this references `Public` from `../common/decorators/public.decorator` — that file does not exist until Task 8 (JWT guard setup). Since `/livez` is excluded from the global prefix and, per Task 9, the global `JwtAuthGuard` will check for `@Public()`, create a minimal placeholder now so this compiles, and Task 8 will be the real implementation:

Create `model1-service/src/common/decorators/public.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 4: Write `health.module.ts`**

Create `model1-service/src/health/health.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- health.controller.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 6: Wire `HealthModule` into `app.module.ts`**

Add the import and add `HealthModule` to the `imports` array.

- [ ] **Step 7: Write the e2e test**

Create `model1-service/test/health.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/livez (GET) returns 200 with status ok when the database is reachable', async () => {
    const response = await request(app.getHttpServer()).get('/livez');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('ok');
  });

  it('/livez (GET) does not require authentication', async () => {
    const response = await request(app.getHttpServer()).get('/livez');
    expect(response.status).not.toBe(401);
  });
});
```

This test requires a real, reachable `sentinel_model1_db` connection (via the `.env` set up in Task 2) — it is an integration test, not a mocked unit test, by design: it's verifying actual DB reachability end-to-end.

- [ ] **Step 8: Run the e2e test to verify it passes**

Run: `npm run test:e2e -- health.e2e-spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 9: Manually verify the 503 path**

Temporarily stop the local Postgres service (or point `DATABASE_URL` at an invalid port in `.env`), run `npm run start:dev`, then `curl -i http://localhost:3000/livez` — expect HTTP 503 with `{"status":"error","database":"unreachable",...}`. Restore the correct `DATABASE_URL` / restart Postgres afterward, and confirm `curl -i http://localhost:3000/livez` returns 200 again.

- [ ] **Step 10: Run the full test suite**

```bash
npm test
npm run test:e2e
```

Expected: all green.

- [ ] **Step 11: Stop — do not commit**

---

## Task 8: `dept-scope` Helper and RBAC Decorators (No Auth Yet — Pure Utilities)

**Files:**
- Create: `model1-service/src/common/decorators/roles.decorator.ts`
- Create: `model1-service/src/common/decorators/current-user.decorator.ts`
- Create: `model1-service/src/common/scoping/dept-scope.helper.ts`
- Create: `model1-service/src/common/scoping/dept-scope.helper.spec.ts`
- Create: `model1-service/src/common/guards/roles.guard.ts`
- Create: `model1-service/src/common/guards/roles.guard.spec.ts`

**Interfaces:**
- Consumes: nothing new (this task builds pure, framework-adjacent utilities used by Task 9's auth module and by every future business module)
- Produces:
  - `@Roles('admin', 'field_officer')` decorator, reads via `Reflector` in `RolesGuard`
  - `@CurrentUser()` param decorator, extracts `request.user` (populated later by `JwtStrategy` in Task 9)
  - `applyDeptScope<T extends object>(baseWhere: T, currentUser: AuthenticatedUser): T & { departmentId?: string }` — the one required choke point for `dept_viewer` row scoping (PRD Section 6a point 4)
  - `RolesGuard` — throws `ForbiddenException` if the authenticated user's role isn't in the route's `@Roles(...)` list

- [ ] **Step 1: Write the failing test for `applyDeptScope`**

Create `model1-service/src/common/scoping/dept-scope.helper.spec.ts`:

```typescript
import { applyDeptScope, AuthenticatedUser } from './dept-scope.helper';

describe('applyDeptScope', () => {
  const deptViewer: AuthenticatedUser = {
    userId: 'user-1',
    role: 'dept_viewer',
    departmentId: 'dept-abc',
  };

  const admin: AuthenticatedUser = {
    userId: 'user-2',
    role: 'admin',
    departmentId: null,
  };

  it('injects departmentId into the where clause for a dept_viewer', () => {
    const result = applyDeptScope({ isActive: true }, deptViewer);
    expect(result).toEqual({ isActive: true, departmentId: 'dept-abc' });
  });

  it('does not modify the where clause for an admin', () => {
    const result = applyDeptScope({ isActive: true }, admin);
    expect(result).toEqual({ isActive: true });
  });

  it('does not modify the where clause for a field_officer', () => {
    const fieldOfficer: AuthenticatedUser = {
      userId: 'user-3',
      role: 'field_officer',
      departmentId: 'dept-xyz',
    };
    const result = applyDeptScope({ isActive: true }, fieldOfficer);
    expect(result).toEqual({ isActive: true });
  });

  it('does not modify the where clause for an auditor', () => {
    const auditor: AuthenticatedUser = {
      userId: 'user-4',
      role: 'auditor',
      departmentId: null,
    };
    const result = applyDeptScope({ isActive: true }, auditor);
    expect(result).toEqual({ isActive: true });
  });

  it('overrides any pre-existing departmentId in baseWhere for a dept_viewer, never letting the caller widen scope', () => {
    const result = applyDeptScope({ departmentId: 'attacker-supplied-dept' }, deptViewer);
    expect(result.departmentId).toBe('dept-abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dept-scope.helper.spec.ts`
Expected: FAIL — `Cannot find module './dept-scope.helper'`

- [ ] **Step 3: Write `dept-scope.helper.ts`**

Create `model1-service/src/common/scoping/dept-scope.helper.ts`:

```typescript
export type AppRole = 'admin' | 'field_officer' | 'dept_viewer' | 'auditor';

export interface AuthenticatedUser {
  userId: string;
  role: AppRole;
  departmentId: string | null;
}

/**
 * The single enforced choke point for dept_viewer row-level scoping
 * (PRD Section 6a point 4). Every service method that reads camera-derived
 * data for a role that can be dept_viewer MUST route its `where` clause
 * through this helper — never build department filtering ad hoc.
 *
 * For a dept_viewer, this ALWAYS overrides any departmentId already present
 * in baseWhere, so a caller can never widen their own scope by passing a
 * different departmentId in a query param.
 */
export function applyDeptScope<T extends Record<string, unknown>>(
  baseWhere: T,
  currentUser: AuthenticatedUser,
): T & { departmentId?: string } {
  if (currentUser.role !== 'dept_viewer') {
    return baseWhere;
  }

  return {
    ...baseWhere,
    departmentId: currentUser.departmentId ?? undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dept-scope.helper.spec.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Write `roles.decorator.ts`**

Create `model1-service/src/common/decorators/roles.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { AppRole } from '../scoping/dept-scope.helper';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 6: Write `current-user.decorator.ts`**

Create `model1-service/src/common/decorators/current-user.decorator.ts`:

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../scoping/dept-scope.helper';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 7: Write the failing test for `RolesGuard`**

Create `model1-service/src/common/guards/roles.guard.spec.ts`:

```typescript
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  function makeContext(user: { role: string } | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no @Roles() decorator is present on the route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = makeContext({ role: 'field_officer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when the user role is in the required roles list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'field_officer']);
    const context = makeContext({ role: 'field_officer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the user role is not in the required roles list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = makeContext({ role: 'dept_viewer' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no authenticated user at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -- roles.guard.spec.ts`
Expected: FAIL — `Cannot find module './roles.guard'`

- [ ] **Step 9: Write `roles.guard.ts`**

Create `model1-service/src/common/guards/roles.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppRole } from '../scoping/dept-scope.helper';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions for this operation');
    }

    return true;
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- roles.guard.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 11: Stop — do not commit**

---

## Task 9: Users Module (Read-Only Lookups for Auth)

**Files:**
- Create: `model1-service/src/users/users.module.ts`
- Create: `model1-service/src/users/users.service.ts`
- Create: `model1-service/src/users/users.service.spec.ts`
- Modify: `model1-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (from Task 3)
- Produces: `UsersService.findByEmail(email: string): Promise<AppUser | null>`, `UsersService.findById(userId: string): Promise<AppUser | null>` — both return the raw Prisma `AppUser` model (including `passwordHash`) since this service is only ever called from within the trusted `auth` module boundary in this plan; a public-facing "safe user" DTO belongs to a later module if/when user profile endpoints are built.

- [ ] **Step 1: Write the failing test**

Create `model1-service/src/users/users.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { appUser: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { appUser: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  it('findByEmail returns the user when found', async () => {
    const fakeUser = { userId: '1', email: 'admin@sentinel.local', role: 'admin' };
    prisma.appUser.findUnique.mockResolvedValue(fakeUser);

    const result = await service.findByEmail('admin@sentinel.local');

    expect(result).toEqual(fakeUser);
    expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@sentinel.local' },
    });
  });

  it('findByEmail returns null when not found', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null);
    const result = await service.findByEmail('nobody@sentinel.local');
    expect(result).toBeNull();
  });

  it('findById returns the user when found', async () => {
    const fakeUser = { userId: 'user-1', email: 'x@y.com', role: 'field_officer' };
    prisma.appUser.findUnique.mockResolvedValue(fakeUser);

    const result = await service.findById('user-1');

    expect(result).toEqual(fakeUser);
    expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('findById returns null when not found', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null);
    const result = await service.findById('nonexistent');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- users.service.spec.ts`
Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 3: Write `users.service.ts`**

Create `model1-service/src/users/users.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AppUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { email } });
  }

  async findById(userId: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({ where: { userId } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- users.service.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Write `users.module.ts`**

Create `model1-service/src/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Wire `UsersModule` into `app.module.ts`**

Add the import and add `UsersModule` to the `imports` array.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all green, no regressions.

- [ ] **Step 8: Stop — do not commit**

---

## Task 10: Refresh Token Service

**Files:**
- Create: `model1-service/src/auth/refresh-token.service.ts`
- Create: `model1-service/src/auth/refresh-token.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3), `ConfigService` (Task 2, for `refreshToken.expiry`)
- Produces:
  - `RefreshTokenService.issue(userId: string): Promise<{ token: string; expiresAt: Date }>` — generates a random opaque token, stores its SHA-256 hash in `refresh_token`, returns the raw token (only time it's ever visible in plaintext) and its expiry
  - `RefreshTokenService.validate(rawToken: string): Promise<{ userId: string } | null>` — looks up by hash, returns `null` if not found, expired, or revoked
  - `RefreshTokenService.revoke(rawToken: string): Promise<void>` — sets `revokedAt` on the matching row; no-op if the token doesn't exist (idempotent logout)

- [ ] **Step 1: Write the failing test**

Create `model1-service/src/auth/refresh-token.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('7d') },
        },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  describe('issue', () => {
    it('creates a refresh_token row and returns a raw token plus expiry', async () => {
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.issue('user-1');

      expect(result.token).toEqual(expect.any(String));
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('never stores the raw token as the tokenHash', async () => {
      prisma.refreshToken.create.mockResolvedValue({});
      const result = await service.issue('user-1');
      const createCallArg = prisma.refreshToken.create.mock.calls[0][0];
      expect(createCallArg.data.tokenHash).not.toBe(result.token);
    });
  });

  describe('validate', () => {
    it('returns the userId for a valid, non-expired, non-revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
      });

      const result = await service.validate('some-raw-token');

      expect(result).toEqual({ userId: 'user-1' });
    });

    it('returns null when the token is not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      const result = await service.validate('unknown-token');
      expect(result).toBeNull();
    });

    it('returns null when the token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      });
      const result = await service.validate('expired-token');
      expect(result).toBeNull();
    });

    it('returns null when the token has been revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(),
      });
      const result = await service.validate('revoked-token');
      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on the matching token row', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ tokenId: 'token-row-1' });
      prisma.refreshToken.update.mockResolvedValue({});

      await service.revoke('raw-token-to-revoke');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { tokenId: 'token-row-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does nothing (no throw) when the token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revoke('nonexistent-token')).resolves.not.toThrow();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- refresh-token.service.spec.ts`
Expected: FAIL — `Cannot find module './refresh-token.service'`

- [ ] **Step 3: Write `refresh-token.service.ts`**

Create `model1-service/src/auth/refresh-token.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import * as ms from 'ms';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(48).toString('hex');
    const expiry = this.configService.get<string>('refreshToken.expiry') ?? '7d';
    const expiresAt = new Date(Date.now() + ms(expiry));

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  async validate(rawToken: string): Promise<{ userId: string } | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;

    return { userId: row.userId };
  }

  async revoke(rawToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!row) return;

    await this.prisma.refreshToken.update({
      where: { tokenId: row.tokenId },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Install the `ms` package used for expiry parsing**

```bash
npm install ms
npm install --save-dev @types/ms
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- refresh-token.service.spec.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 11: Auth Service, JWT Strategy, and Login/Refresh/Logout Endpoints

**Files:**
- Create: `model1-service/src/auth/dto/login.dto.ts`
- Create: `model1-service/src/auth/dto/refresh-token.dto.ts`
- Create: `model1-service/src/auth/auth.service.ts`
- Create: `model1-service/src/auth/auth.service.spec.ts`
- Create: `model1-service/src/auth/strategies/jwt.strategy.ts`
- Create: `model1-service/src/common/guards/jwt-auth.guard.ts`
- Create: `model1-service/src/common/guards/jwt-auth.guard.spec.ts`
- Create: `model1-service/src/auth/auth.controller.ts`
- Create: `model1-service/src/auth/auth.controller.spec.ts`
- Create: `model1-service/src/auth/auth.module.ts`
- Test: `model1-service/test/auth.e2e-spec.ts`
- Modify: `model1-service/src/app.module.ts`

**Interfaces:**
- Consumes: `UsersService.findByEmail`/`findById` (Task 9), `RefreshTokenService.issue`/`validate`/`revoke` (Task 10), `ConfigService` (Task 2)
- Produces:
  - `POST /api/v1/auth/login` → `{ accessToken, refreshToken }` (200) or 401 on bad credentials
  - `POST /api/v1/auth/refresh` → `{ accessToken }` (200) or 401 on invalid/expired/revoked refresh token
  - `POST /api/v1/auth/logout` → 204, revokes the caller's refresh token
  - `JwtAuthGuard` registered as the **global** default guard — every route requires a valid JWT unless annotated `@Public()`
  - `JwtStrategy` populates `request.user: AuthenticatedUser` (matching the shape from Task 8's `dept-scope.helper.ts`)

- [ ] **Step 1: Install auth dependencies**

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt
npm install --save-dev @types/passport-jwt @types/bcrypt
```

- [ ] **Step 2: Write the DTOs**

Create `model1-service/src/auth/dto/login.dto.ts`:

```typescript
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
```

Create `model1-service/src/auth/dto/refresh-token.dto.ts`:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
```

- [ ] **Step 3: Write the failing test for `AuthService`**

Create `model1-service/src/auth/auth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; findById: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let refreshTokenService: { issue: jest.Mock; validate: jest.Mock; revoke: jest.Mock };

  const passwordHash = bcrypt.hashSync('correct-password', 10);
  const fakeUser = {
    userId: 'user-1',
    email: 'admin@sentinel.local',
    passwordHash,
    role: 'admin',
    departmentId: null,
  };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), findById: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };
    refreshTokenService = {
      issue: jest.fn().mockResolvedValue({ token: 'raw-refresh-token', expiresAt: new Date() }),
      validate: jest.fn(),
      revoke: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('returns an access token and refresh token for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser);

      const result = await service.login('admin@sentinel.local', 'correct-password');

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.refreshToken).toBe('raw-refresh-token');
      expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
    });

    it('throws UnauthorizedException for an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.login('nobody@sentinel.local', 'anything')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser);
      await expect(service.login('admin@sentinel.local', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('never reveals whether the failure was a bad email or bad password', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      try {
        await service.login('nobody@sentinel.local', 'anything');
        fail('expected to throw');
      } catch (e) {
        expect((e as UnauthorizedException).message).toBe('Invalid credentials');
      }

      usersService.findByEmail.mockResolvedValue(fakeUser);
      try {
        await service.login('admin@sentinel.local', 'wrong-password');
        fail('expected to throw');
      } catch (e) {
        expect((e as UnauthorizedException).message).toBe('Invalid credentials');
      }
    });
  });

  describe('refresh', () => {
    it('returns a new access token for a valid refresh token', async () => {
      refreshTokenService.validate.mockResolvedValue({ userId: 'user-1' });
      usersService.findById.mockResolvedValue(fakeUser);

      const result = await service.refresh('valid-raw-refresh-token');

      expect(result.accessToken).toBe('signed-jwt-token');
    });

    it('throws UnauthorizedException for an invalid/expired/revoked refresh token', async () => {
      refreshTokenService.validate.mockResolvedValue(null);
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if the user behind a valid token no longer exists', async () => {
      refreshTokenService.validate.mockResolvedValue({ userId: 'deleted-user' });
      usersService.findById.mockResolvedValue(null);
      await expect(service.refresh('valid-token-orphaned-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the given refresh token', async () => {
      await service.logout('some-raw-refresh-token');
      expect(refreshTokenService.revoke).toHaveBeenCalledWith('some-raw-refresh-token');
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL — `Cannot find module './auth.service'`

- [ ] **Step 5: Write `auth.service.ts`**

Create `model1-service/src/auth/auth.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

interface RefreshResult {
  accessToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  private signAccessToken(user: { userId: string; role: string; departmentId: string | null }) {
    return this.jwtService.sign({
      sub: user.userId,
      role: user.role,
      departmentId: user.departmentId,
    });
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.signAccessToken(user);
    const { token: refreshToken } = await this.refreshTokenService.issue(user.userId);

    return { accessToken, refreshToken };
  }

  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const validated = await this.refreshTokenService.validate(rawRefreshToken);
    if (!validated) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(validated.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(user);
    return { accessToken };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(rawRefreshToken);
  }
}
```

Note: bad-email and bad-password both throw the identical `UnauthorizedException('Invalid credentials')` message deliberately — this prevents an attacker from using the login endpoint to enumerate which emails are registered.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 7: Write `jwt.strategy.ts`**

Create `model1-service/src/auth/strategies/jwt.strategy.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../common/scoping/dept-scope.helper';

interface JwtPayload {
  sub: string;
  role: AuthenticatedUser['role'];
  departmentId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return {
      userId: payload.sub,
      role: payload.role,
      departmentId: payload.departmentId,
    };
  }
}
```

- [ ] **Step 8: Write the failing test for `JwtAuthGuard`**

Create `model1-service/src/common/guards/jwt-auth.guard.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  function makeContext() {
    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('bypasses authentication (returns true) when the route is marked @Public()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = makeContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('delegates to the parent AuthGuard when the route is not public', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = makeContext();
    const parentCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(context);

    expect(parentCanActivateSpy).toHaveBeenCalled();
    expect(result).toBe(true);
    parentCanActivateSpy.mockRestore();
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npm test -- jwt-auth.guard.spec.ts`
Expected: FAIL — `Cannot find module './jwt-auth.guard'`

- [ ] **Step 10: Write `jwt-auth.guard.ts`**

Create `model1-service/src/common/guards/jwt-auth.guard.ts`:

```typescript
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npm test -- jwt-auth.guard.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 12: Write the failing test for `AuthController`**

Create `model1-service/src/auth/auth.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; refresh: jest.Mock; logout: jest.Mock };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get(AuthController);
  });

  it('login delegates to AuthService.login with email and password', async () => {
    authService.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const result = await controller.login({ email: 'x@y.com', password: 'pw' });

    expect(authService.login).toHaveBeenCalledWith('x@y.com', 'pw');
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('refresh delegates to AuthService.refresh with the provided token', async () => {
    authService.refresh.mockResolvedValue({ accessToken: 'new-token' });

    const result = await controller.refresh({ refreshToken: 'old-token' });

    expect(authService.refresh).toHaveBeenCalledWith('old-token');
    expect(result).toEqual({ accessToken: 'new-token' });
  });

  it('logout delegates to AuthService.logout with the provided token', async () => {
    await controller.logout({ refreshToken: 'token-to-revoke' });
    expect(authService.logout).toHaveBeenCalledWith('token-to-revoke');
  });
});
```

- [ ] **Step 13: Run test to verify it fails**

Run: `npm test -- auth.controller.spec.ts`
Expected: FAIL — `Cannot find module './auth.controller'`

- [ ] **Step 14: Write `auth.controller.ts`**

Create `model1-service/src/auth/auth.controller.ts`:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }
}
```

Note the `@Throttle({ default: { limit: 5, ttl: 60000 } })` override on `login` — this is the 5 req/min override from PRD Section 6a point 9, layered on top of the global 100 req/min default from Task 5.

- [ ] **Step 15: Run test to verify it passes**

Run: `npm test -- auth.controller.spec.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 16: Write `auth.module.ts`**

Create `model1-service/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: { expiresIn: configService.get<string>('jwt.expiry') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 17: Wire `AuthModule` into `app.module.ts` and register `JwtAuthGuard` + `RolesGuard` globally**

Modify `model1-service/src/app.module.ts` to its final Phase 1-4 form:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

NestJS applies multiple `APP_GUARD` providers in registration order — Throttler first (reject early on rate abuse before any auth work), then JwtAuthGuard (authenticate), then RolesGuard (authorize). This also means the root `AppController`'s default `GET /` route now requires a JWT unless marked `@Public()` — mark it public since it's just the scaffold's placeholder banner route:

Modify `model1-service/src/app.controller.ts` — read its current content first, then add the `@Public()` decorator to its one existing route method.

- [ ] **Step 18: Run the full unit test suite**

```bash
npm test
```

Expected: all green. If `AppController`'s existing spec now fails because the route requires auth in an e2e-style test, that's addressed by Step 17's `@Public()` fix above — pure unit tests that mock the guard away are unaffected.

- [ ] **Step 19: Write the e2e test**

Create `model1-service/test/auth.e2e-spec.ts`. This test seeds a real test user via Prisma directly (bcrypt-hashing a known password), then exercises the full login → refresh → logout cycle against the real database:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = 'e2e-auth-test-user@sentinel.local';
  const testPassword = 'CorrectHorseBatteryStaple123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await prisma.appUser.deleteMany({ where: { email: testEmail } });
    await prisma.appUser.create({
      data: {
        email: testEmail,
        passwordHash: await bcrypt.hash(testPassword, 10),
        role: 'admin',
      },
    });
  });

  afterAll(async () => {
    await prisma.appUser.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  it('rejects login with wrong password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects login with unknown email', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody-at-all@sentinel.local', password: testPassword });

    expect(response.status).toBe(401);
  });

  it('logs in successfully and returns an access token and refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a protected route with no token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/');
    expect(response.status).toBe(401);
  });

  it('completes the full login -> refresh -> logout -> refresh-fails cycle', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const { refreshToken } = loginResponse.body;

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshResponse.status).toBe(201);
    expect(refreshResponse.body.accessToken).toEqual(expect.any(String));

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken });

    expect(logoutResponse.status).toBe(204);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshAfterLogout.status).toBe(401);
  });

  it('rejects an invalid/garbage refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'this-is-not-a-real-token' });

    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 20: Run the e2e test to verify it passes**

Run: `npm run test:e2e -- auth.e2e-spec.ts`
Expected: PASS, all 6 tests green. This requires a reachable `sentinel_model1_db` via the local `.env`.

- [ ] **Step 21: Manually verify with curl end-to-end**

```bash
npm run start:dev
```

In a second terminal (using the seed admin user from `model1_fresh_setup.sql` — note its seeded `password_hash` is a placeholder string, not a real bcrypt hash of any known password, so login against it will correctly fail; use the e2e test's approach of creating a real user for a manual check, or temporarily update the seed admin's password hash to a known bcrypt value for this manual verification only, reverting afterward):

```bash
curl -i http://localhost:3000/api/v1/livez  # sanity check, should be unaffected by auth
curl -i http://localhost:3000/api/v1/       # should now be 401 with no token
```

Expected: `/livez` still 200, root route now 401 with the standard error JSON shape from Task 4. Stop the server.

- [ ] **Step 22: Run the full test suite (unit + e2e) for regressions**

```bash
npm test
npm run test:e2e
```

Expected: all green.

- [ ] **Step 23: Stop — do not commit**

---

## Task 12: Audit Log Interceptor (Scaffold, Wired to Real Writes)

**Files:**
- Create: `model1-service/src/common/interceptors/audit-log.interceptor.ts`
- Create: `model1-service/src/common/interceptors/audit-log.interceptor.spec.ts`
- Create: `model1-service/src/common/decorators/audit.decorator.ts`
- Modify: `model1-service/src/auth/auth.controller.ts`
- Modify: `model1-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3), `request.correlationId` (Task 4), `request.user` (Task 11)
- Produces: `@Audit('login', 'app_user')` decorator + a global `AuditLogInterceptor` that, on successful responses from a decorated route, writes one row to `audit_log` with `{ userId, action, entityType, entityId, metadata: { correlationId, ...} }`. This plan wires it onto the three auth endpoints as a working example; future business modules (camera-registry, etc.) apply the same decorator to their own mutating routes.

- [ ] **Step 1: Write the failing test**

Create `model1-service/src/common/interceptors/audit-log.interceptor.spec.ts`:

```typescript
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: { auditLog: { create: jest.Mock } };
  let reflector: Reflector;

  function makeContext(user: any, correlationId = 'corr-1') {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user, correlationId, body: { email: 'x@y.com' } }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  function makeCallHandler(response: unknown) {
    return { handle: () => of(response) } as CallHandler;
  }

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    reflector = new Reflector();
    interceptor = new AuditLogInterceptor(prisma as unknown as PrismaService, reflector);
  });

  it('writes an audit_log row when the route is decorated with @Audit and the user is known', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            userId: 'user-1',
            action: 'login',
            entityType: 'app_user',
            metadata: expect.objectContaining({ correlationId: 'corr-1' }),
          }),
        });
        done();
      });
    });
  });

  it('does nothing when the route has no @Audit metadata', (done) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ ok: true });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('writes a row with a null userId for an unauthenticated action (e.g. login itself has no user yet before success)', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    const context = makeContext(undefined);
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe(() => {
      setImmediate(() => {
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ userId: null }),
        });
        done();
      });
    });
  });

  it('does not block or fail the response if the audit write itself throws', (done) => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue({ action: 'login', entityType: 'app_user' });
    prisma.auditLog.create.mockRejectedValue(new Error('db write failed'));
    const context = makeContext({ userId: 'user-1' });
    const handler = makeCallHandler({ accessToken: 'abc' });

    interceptor.intercept(context, handler).subscribe((response) => {
      expect(response).toEqual({ accessToken: 'abc' });
      done();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- audit-log.interceptor.spec.ts`
Expected: FAIL — `Cannot find module './audit-log.interceptor'`

- [ ] **Step 3: Write `audit.decorator.ts`**

Create `model1-service/src/common/decorators/audit.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  entityType: string;
}

export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_KEY, { action, entityType } as AuditMetadata);
```

- [ ] **Step 4: Write `audit-log.interceptor.ts`**

Create `model1-service/src/common/interceptors/audit-log.interceptor.ts`:

```typescript
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_KEY, AuditMetadata } from '../decorators/audit.decorator';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMeta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const correlationId: string | undefined = request.correlationId;
    const userId: string | null = request.user?.userId ?? null;

    return next.handle().pipe(
      tap(() => {
        this.prisma.auditLog
          .create({
            data: {
              userId,
              action: auditMeta.action,
              entityType: auditMeta.entityType,
              metadata: { correlationId },
            },
          })
          .catch((error: Error) => {
            this.logger.error(
              `Failed to write audit log for action "${auditMeta.action}" [${correlationId}]: ${error.message}`,
            );
          });
      }),
    );
  }
}
```

Note: the audit write happens fire-and-forget with a `.catch()` that only logs — a broken audit log must never fail the underlying request, matching the same resilience philosophy the PRD applies to the AI provider (Section 9).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- audit-log.interceptor.spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Wire the interceptor globally and annotate the auth endpoints**

Modify `model1-service/src/app.module.ts` — add `APP_INTERCEPTOR` registration:

```typescript
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
// ...
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
```

Add to the `providers` array:

```typescript
{
  provide: APP_INTERCEPTOR,
  useClass: AuditLogInterceptor,
},
```

Modify `model1-service/src/auth/auth.controller.ts` to annotate `login` and `logout` (not `refresh` — refreshing a token isn't a state-changing action worth an audit entry per PRD Section 7's list of create/update/delete/export actions):

Add the import `import { Audit } from '../common/decorators/audit.decorator';` and add `@Audit('login', 'app_user')` above the `login()` method and `@Audit('logout', 'app_user')` above the `logout()` method.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
npm run test:e2e
```

Expected: all green, no regressions. The `auth.e2e-spec.ts` login test still passes since the audit write is fire-and-forget and doesn't block the response.

- [ ] **Step 8: Manually verify an audit row is actually written**

```bash
npm run start:dev
```

In a second terminal, log in with the e2e test's approach (or any valid seeded user), then check:

```bash
PGPASSWORD='Meet@0326' psql -U meet -h localhost -p 5432 -d sentinel_model1_db -c "SELECT action, entity_type, metadata FROM audit_log ORDER BY created_at DESC LIMIT 5;"
```

Expected: a `login` row appears with a `metadata` JSON containing a `correlationId` key. Stop the server once confirmed.

- [ ] **Step 9: Stop — do not commit**

---

## Task 13: Documentation — `docs/MAIN.md` and Phase-Specific Docs

**Files:**
- Create: `model1-service/docs/MAIN.md`
- Create: `model1-service/docs/01-backend-foundation.md`
- Create: `model1-service/docs/02-database-schema.md`
- Create: `model1-service/docs/03-health-and-infrastructure.md`
- Create: `model1-service/docs/04-authentication-and-authorization.md`
- Create: `model1-service/docs/testing/01-backend-foundation-qa.md`
- Create: `model1-service/docs/testing/02-database-schema-qa.md`
- Create: `model1-service/docs/testing/03-health-and-infrastructure-qa.md`
- Create: `model1-service/docs/testing/04-authentication-and-authorization-qa.md`
- Create: `model1-service/docs/architecture/system-architecture.md`
- Create: `model1-service/docs/architecture/database-architecture.md`
- Create: `model1-service/docs/architecture/api-architecture.md`
- Create: `model1-service/docs/architecture/security.md`

**Interfaces:**
- Consumes: nothing (pure documentation, written after Tasks 1-12 are complete and passing, so it documents what was actually built rather than what was planned)
- Produces: the doc structure the user specified, matching their exact tree layout

- [ ] **Step 1: Write `docs/architecture/system-architecture.md`**

Document the modular monolith approach: single NestJS process, strict module boundaries via DI only (never cross-module Prisma table access), the module list and their responsibilities (prisma, common, health, users, auth — plus the four business modules planned for later: camera-registry, integration-scoring, health-monitoring, gis), and the global request pipeline order (correlation ID middleware → throttler guard → JWT guard → roles guard → validation pipe → controller → audit interceptor → exception filter on error). Reference `Model1-PRD.md` and `Model1-Low-Level-Design.md` at the repo root as the source specs.

- [ ] **Step 2: Write `docs/architecture/database-architecture.md`**

Document: PostgreSQL + PostGIS, Prisma as the ORM, the `PrismaService`/`PrismaModule` pattern (one global connection, injected everywhere), the introspection workflow (`db pull` then reconcile against the hand-maintained reference schema — never hand-write from scratch), the migration policy (`prisma migrate dev` only, from this point forward, per PRD Section 6), and a summary of every table that exists today (department, app_user, refresh_token, camera, vendor_lookup, scoring_verification, camera_status_history, audit_log) with one sentence each on purpose — no full column-level detail here, that lives in the schema file itself and the PRD.

- [ ] **Step 3: Write `docs/architecture/api-architecture.md`**

Document: the `/api/v1` global prefix (with `/livez` as the one exclusion), the standard error response shape from `AllExceptionsFilter`, the pagination convention (`PaginationDto`, default 25/max 100), the correlation ID header convention (`x-correlation-id` in and out), and the rate-limiting tiers (100/min global default, 5/min on `/auth/login`).

- [ ] **Step 4: Write `docs/architecture/security.md`**

Document: JWT access token (15 min) + hashed refresh token (7 days, SHA-256, stored in `refresh_token`) design and why (revocability), the RBAC model (four roles, `@Roles()` + `RolesGuard`), the `dept_viewer` row-scoping mechanism (`applyDeptScope` as the single enforced choke point — flag explicitly that Postgres RLS is a documented future hardening step, not yet implemented), password hashing (bcrypt), and the CORS allowlist policy.

- [ ] **Step 5: Write `docs/01-backend-foundation.md`**

Document what Task 1-6 actually built: project scaffold, environment configuration + validation (`env.validation.ts`), the global exception filter, correlation ID middleware, throttler setup, and the pagination DTO. Include the actual file paths from the File Structure section above. Note explicitly: "no business functionality implemented in this phase," matching the user's original phase-1 scope framing.

- [ ] **Step 6: Write `docs/02-database-schema.md`**

Document what Task 3 built: Prisma setup, the introspection + reconciliation workflow actually followed, and a link/reference to the repo-root `schema.prisma` and `model1_fresh_setup.sql` as the sources of truth (do not duplicate the full schema text here — reference it).

- [ ] **Step 7: Write `docs/03-health-and-infrastructure.md`**

Document what Task 7 built: the `/livez` endpoint, its 200/503 behavior, and that it's distinct from the future per-camera health-monitoring business module.

- [ ] **Step 8: Write `docs/04-authentication-and-authorization.md`**

Document what Tasks 8-12 built: the login/refresh/logout flow, the `JwtStrategy`/`JwtAuthGuard`/`RolesGuard` pipeline, the `applyDeptScope` helper (and that it has no real callers yet until a business module needs it), and the audit log interceptor wired onto the auth endpoints as a working reference example for future modules to copy.

- [ ] **Step 9: Write the four QA docs under `docs/testing/`**

For each of `01-backend-foundation-qa.md`, `02-database-schema-qa.md`, `03-health-and-infrastructure-qa.md`, `04-authentication-and-authorization-qa.md`: list the actual test files that cover that phase (from Tasks 1-12 above), what scenarios each covers (happy path, validation, error handling, security, concurrency where applicable — e.g. Task 11's e2e test covers the full login→refresh→logout→refresh-fails cycle, Task 7 covers both the 200 and 503 health paths), and the exact commands to re-run them (`npm test -- <file>`, `npm run test:e2e -- <file>`). This is a review checklist, not new test code — it documents what Tasks 1-12's own test-writing steps already produced.

- [ ] **Step 10: Write `docs/MAIN.md`**

This is the master index. Include:
- **Overall project objective:** one paragraph, adapted from `Model1-PRD.md` Section 1-2.
- **System architecture:** link to `architecture/system-architecture.md`, one-paragraph summary.
- **Backend technology stack:** NestJS/TypeScript/Node 24, listed plainly.
- **Database technology:** PostgreSQL + PostGIS + Prisma, link to `architecture/database-architecture.md`.
- **API architecture:** link to `architecture/api-architecture.md`.
- **Authentication strategy / Authorization strategy:** link to `architecture/security.md` and `04-authentication-and-authorization.md`.
- **Module list:** `prisma`, `common`, `health`, `users`, `auth` (built), plus `camera-registry`, `integration-scoring`, `health-monitoring`, `gis` (not yet built — planned per `Model1-PRD.md` Section 5).
- **Implementation sequence:** the exact Phase 1-4 order from this plan, each linked to its doc.
- **Testing strategy / QA strategy:** summarize the TDD-per-task approach actually used (failing test → implementation → passing test, unit + e2e), link to `docs/testing/`.
- **Security strategy:** link to `architecture/security.md`.
- **Deployment strategy:** **[Needs Decision]** — not yet decided; flag explicitly rather than inventing one.
- **Environment configuration:** reference `.env.example` and `src/config/`.
- **Logging and monitoring:** correlation IDs + NestJS `Logger`, no external monitoring service wired yet — **[Needs Decision]** for anything beyond that.
- **Links to every implementation document:** a table linking all files under `docs/`.
- **Current implementation status:** a table with rows for Phase 1 (Foundation) through Phase 4 (Auth), each marked "Complete" only if Tasks 1-12 in this plan actually passed their tests — do not mark anything complete that wasn't verified.
- **Known issues:** list anything discovered during implementation that didn't get fixed (e.g., if any manual verification step in Tasks 1-12 surfaced something worth flagging).
- **Future improvements:** Postgres RLS for `dept_viewer` (PRD Section 6a point 4 stretch goal), refresh token rotation on each use (not implemented in Task 10 — only issuance/validation/revocation), and the four business modules from Phase 5+.

- [ ] **Step 11: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every spec file from Tasks 1-12 passes, zero failures.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: `health.e2e-spec.ts`, `auth.e2e-spec.ts`, `throttler.e2e-spec.ts`, and the default `app.e2e-spec.ts` all pass.

- [ ] **Step 3: Boot the app one final time and manually walk the whole flow**

```bash
npm run start:dev
```

- `curl -i http://localhost:3000/livez` → 200
- `curl -i http://localhost:3000/api/v1/` → 401 (no token)
- Log in with a real seeded/test user, capture the access + refresh tokens
- `curl -i http://localhost:3000/api/v1/ -H "Authorization: Bearer <accessToken>"` → 200
- Use the refresh token to get a new access token
- Log out, then confirm the same refresh token now fails

Stop the server once every step above behaves as expected.

- [ ] **Step 4: Confirm `docs/MAIN.md`'s status table accurately reflects reality**

Re-read `docs/MAIN.md`'s "Current implementation status" table against the actual test results from Steps 1-2. Fix any discrepancy.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize what was built, what passed, and any `[Needs Decision]`/`[Open Question]` items surfaced along the way (e.g., deployment strategy, logging/monitoring beyond correlation IDs, refresh token rotation). The user reviews and commits at their own discretion — this plan's execution never touches git.
