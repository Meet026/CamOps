# Frontend Backend-Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 7 of the 10 gaps tracked in `frontend/BACKEND_GAPS.md`: `GET /departments`, `GET /auth/me`, `GET /users`, camera `ipAddress`/`rtspPort`/`streamPath` via `PATCH /cameras/:id`, `GET /vendor-lookup/brands`, `search` on `GET /cameras`, and `POST /auth/change-password` — building each backend endpoint then immediately wiring the corresponding frontend integration, so every gap closes completely (backend + frontend + `BACKEND_GAPS.md` updated) before moving to the next.

**Architecture:** All new backend endpoints follow patterns already established in this codebase exactly — no new architectural shapes. Frontend changes replace each interim stopgap (hardcoded department list, lookup-by-ID user panel, `<ComingSoon />` shells) with real `apiClient`/TanStack Query integration, matching the existing `src/api/*.ts` + `src/hooks/use*.ts` conventions.

**Tech Stack:** Backend: NestJS, Prisma, class-validator (unchanged). Frontend: React, TanStack Query, axios (unchanged).

**Spec:** `model1-service/docs/superpowers/specs/2026-08-27-frontend-gap-closure-design.md`

## Global Constraints

- Every new backend endpoint gets unit tests (mocked Prisma) + e2e tests (real database) + manual live-server verification, matching every prior module's discipline in this project.
- `CameraRecord`/`RawCameraRow`/`mapRow`/`CAMERA_SELECT_SQL` in `camera-registry.service.ts` all need `ipAddress`/`rtspPort`/`streamPath` added — confirmed by inspection during planning that these fields would otherwise be write-only (settable via `PATCH` but never returned by any read), a real gap the design spec didn't call out explicitly.
- `GET /users` and `GET /auth/me` never include `passwordHash` in any response — always an explicit `select`, never a bare `findMany()`/`findUnique()` that would return the whole row.
- Frontend: every gap closure removes its row from `frontend/BACKEND_GAPS.md` (or moves it to a new "Closed" section — implementer's call, keep the file coherent) in the same task that closes it.
- No git commits at any point, per this project's standing rule.

---

## Task 1: `GET /departments`

**Files:**
- Create: `src/departments/departments.module.ts`
- Create: `src/departments/departments.controller.ts`
- Create: `src/departments/departments.service.ts`
- Create: `src/departments/departments.service.spec.ts`
- Create: `src/departments/departments.controller.spec.ts`
- Create: `test/departments.e2e-spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `DepartmentsService.list(): Promise<{ departmentId: string; name: string; code: string }[]>`, `GET /departments` → `200`, roles: all authenticated (no `@Roles()` decorator — passes through for any valid JWT, per `RolesGuard`'s existing behavior).

- [ ] **Step 1: Write the failing service test**

Create `src/departments/departments.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsService } from './departments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let prisma: { department: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { department: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DepartmentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DepartmentsService);
  });

  it('returns departmentId, name, code for every department, no pagination', async () => {
    prisma.department.findMany.mockResolvedValue([
      { departmentId: 'dept-1', name: 'Home Department (Police)', code: 'HOME' },
    ]);

    const result = await service.list();

    expect(prisma.department.findMany).toHaveBeenCalledWith({
      select: { departmentId: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toEqual([{ departmentId: 'dept-1', name: 'Home Department (Police)', code: 'HOME' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- departments.service.spec.ts`
Expected: FAIL — `Cannot find module './departments.service'`

- [ ] **Step 3: Write `departments.service.ts`**

Create `src/departments/departments.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DepartmentSummary {
  departmentId: string;
  name: string;
  code: string;
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<DepartmentSummary[]> {
    return this.prisma.department.findMany({
      select: { departmentId: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- departments.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

Create `src/departments/departments.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

describe('DepartmentsController', () => {
  let controller: DepartmentsController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [{ provide: DepartmentsService, useValue: service }],
    }).compile();

    controller = module.get(DepartmentsController);
  });

  it('list delegates to DepartmentsService.list', async () => {
    const departments = [{ departmentId: 'dept-1', name: 'Home', code: 'HOME' }];
    service.list.mockResolvedValue(departments);

    const result = await controller.list();

    expect(service.list).toHaveBeenCalledWith();
    expect(result).toEqual(departments);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- departments.controller.spec.ts`
Expected: FAIL — `Cannot find module './departments.controller'`

- [ ] **Step 7: Write `departments.controller.ts`**

Create `src/departments/departments.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  async list() {
    return this.departmentsService.list();
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- departments.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Create `departments.module.ts` and register in `app.module.ts`**

Create `src/departments/departments.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
})
export class DepartmentsModule {}
```

Modify `src/app.module.ts` — add the import and add `DepartmentsModule` to `imports`.

- [ ] **Step 10: Write the e2e test**

Create `test/departments.e2e-spec.ts`, following the same structure (real login, real HTTP) as every prior e2e spec in this project:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Departments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const email = 'e2e-departments-viewer@sentinel.local';
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), role: 'dept_viewer', departmentId: 'c4cedd68-5fca-4a1f-b6bd-b607e0840436' },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.appUser.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns all departments for any authenticated role, including dept_viewer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThanOrEqual(3);
    expect(response.body[0]).toHaveProperty('departmentId');
    expect(response.body[0]).toHaveProperty('name');
    expect(response.body[0]).toHaveProperty('code');
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/departments');
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 11: Run the e2e test**

Run: `npm run test:e2e -- departments.e2e-spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 12: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 13: Frontend — replace the hardcoded department list**

Modify `frontend/src/api/`: create `frontend/src/api/departments.ts`:

```typescript
import { apiClient } from './client'

export interface Department {
  departmentId: string
  name: string
  code: string
}

export async function listDepartments(): Promise<Department[]> {
  const response = await apiClient.get<Department[]>('/departments')
  return response.data
}
```

Create `frontend/src/hooks/useDepartments.ts`:

```typescript
import { useQuery } from '@tanstack/react-query'
import * as departmentsApi from '@/api/departments'

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.listDepartments(),
    staleTime: 5 * 60 * 1000, // departments essentially never change mid-session
  })
}
```

Modify every file currently importing `DEPARTMENTS` from `frontend/src/lib/departments.ts`
(`CameraListPage.tsx`, `CameraFormPage.tsx`, `CameraDetailPage.tsx`,
`HealthDashboardPage.tsx`, `CameraPinMarker.tsx`) — replace the static
import with `const { data: departments = [] } = useDepartments()` and
replace every `DEPARTMENTS.find(...)`/`DEPARTMENTS.map(...)` usage with
`departments.find(...)`/`departments.map(...)`. Delete
`frontend/src/lib/departments.ts` once no file imports it anymore
(verify with `grep -rn "lib/departments" frontend/src` returning nothing).

- [ ] **Step 14: Update `BACKEND_GAPS.md`**

Modify `frontend/BACKEND_GAPS.md` — remove row #1 (or mark it resolved),
noting the endpoint now exists and the frontend uses it directly.

- [ ] **Step 15: Manually verify against a live server**

Start both servers, log in, confirm the Camera List's department filter,
the Add Camera form's department dropdown, and the Health dashboard's
department names all populate from the real endpoint (check the Network
tab / a `console.log` shows a real `GET /departments` call, not the old
static import). Stop both servers.

- [ ] **Step 16: Stop — do not commit**

---

## Task 2: `GET /auth/me`

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/auth.service.spec.ts`
- Modify: `src/auth/auth.controller.spec.ts`
- Modify: `test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `AuthService.getProfile(userId): Promise<{ userId, email, role, departmentId }>`, `GET /auth/me` → `200`, roles: all authenticated.

- [ ] **Step 1: Write the failing service test**

Add to `src/auth/auth.service.spec.ts` — this file already mocks
`UsersService` (used by `refresh`); reuse that mock. Add:

```typescript
  describe('getProfile', () => {
    it('returns userId, email, role, departmentId for the given user', async () => {
      usersService.findById.mockResolvedValue({
        userId: 'user-1',
        email: 'admin@sentinel.local',
        role: 'admin',
        departmentId: null,
        passwordHash: 'irrelevant',
      });

      const result = await service.getProfile('user-1');

      expect(result).toEqual({
        userId: 'user-1',
        email: 'admin@sentinel.local',
        role: 'admin',
        departmentId: null,
      });
    });

    it('throws UnauthorizedException when the user no longer exists', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.getProfile('missing-user')).rejects.toThrow(UnauthorizedException);
    });
  });
```

(Check the existing top of the file for the exact mock variable name —
likely `usersService` — and `UnauthorizedException` import; merge into
the existing `@nestjs/common` import if already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL — `service.getProfile is not a function`

- [ ] **Step 3: Add `getProfile` to `auth.service.ts`**

Modify `src/auth/auth.service.ts` — add this method and export interface:

```typescript
export interface ProfileResult {
  userId: string;
  email: string;
  role: string;
  departmentId: string | null;
}
```

```typescript
  async getProfile(userId: string): Promise<ProfileResult> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

Add to `src/auth/auth.controller.spec.ts`:

```typescript
  it('me delegates to AuthService.getProfile with the current user id', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const profile = { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null };
    service.getProfile = jest.fn().mockResolvedValue(profile);

    const result = await controller.me(currentUser);

    expect(service.getProfile).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(profile);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- auth.controller.spec.ts`
Expected: FAIL — `controller.me is not a function`

- [ ] **Step 7: Add the `me` endpoint**

Modify `src/auth/auth.controller.ts` — add imports:

```typescript
import { Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';
```

(merge `Get` into the existing `@nestjs/common` import)

Add the endpoint — **no `@Public()` decorator**, since this must require
authentication (unlike `login`/`refresh`):

```typescript
  @Get('me')
  async me(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.getProfile(currentUser.userId);
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- auth.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Add an e2e test**

Add to `test/auth.e2e-spec.ts` (existing file — find its `describe` block
and add alongside the existing login/refresh/logout tests):

```typescript
  it('GET /auth/me returns the current user profile including email', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`); // reuse whatever token variable the existing tests use

    expect(response.status).toBe(200);
    expect(response.body.email).toBeDefined();
    expect(response.body.role).toBeDefined();
  });

  it('GET /auth/me rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });
```

- [ ] **Step 10: Run the e2e test**

Run: `npm run test:e2e -- auth.e2e-spec.ts`
Expected: PASS, all tests (existing + new) green.

- [ ] **Step 11: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 12: Frontend — wire up `/auth/me`**

Modify `frontend/src/api/auth.ts` — add:

```typescript
import type { AuthenticatedUser } from '@/types/api'

export interface UserProfile extends AuthenticatedUser {
  email: string
}

export async function getMe(): Promise<UserProfile> {
  const response = await apiClient.get<UserProfile>('/auth/me')
  return response.data
}
```

Modify `frontend/src/contexts/AuthContext.tsx` — extend `AuthContextValue`
with a `profile: UserProfile | null` field, fetched via a `useQuery(['auth',
'me'], authApi.getMe, { enabled: isAuthenticated })` call inside
`AuthProvider`, exposed alongside `user`. (`user` — derived from the JWT —
stays as the fast, synchronous source for role/departmentId used by
route guards; `profile` is the slower, richer version used only where
email is actually displayed.)

Modify `frontend/src/pages/settings/SettingsPage.tsx` — replace the "User
ID" row in the Account panel with the real `profile?.email`, sourced from
`useAuth().profile` instead of only showing `user?.userId`.

- [ ] **Step 13: Update `BACKEND_GAPS.md`**

Remove/resolve row #10.

- [ ] **Step 14: Manually verify against a live server**

Log in, confirm Settings' Account panel now shows the real email address.
Stop both servers.

- [ ] **Step 15: Stop — do not commit**

---

## Task 3: `GET /users`

**Files:**
- Modify: `src/users/users.controller.ts`
- Modify: `src/users/users.service.ts`
- Modify: `src/users/users.service.spec.ts` (create if it doesn't exist)
- Modify: `src/users/users.controller.spec.ts` (create if it doesn't exist)
- Create: `src/users/dto/list-users-query.dto.ts`
- Modify: `test/` — extend or create a users e2e spec

**Interfaces:**
- Produces: `UsersService.list(query: {page, limit}): Promise<{userId, email, role, departmentId}[]>`, `GET /users` → `200`, roles: admin only.

- [ ] **Step 1: Check for existing `users.service.spec.ts`/`users.controller.spec.ts`**

Run: `ls src/users/*.spec.ts`. If neither exists, this task creates them
fresh (matching the pattern of every other module's spec file in this
codebase); if they exist, extend them instead of overwriting.

- [ ] **Step 2: Write `list-users-query.dto.ts`**

Create `src/users/dto/list-users-query.dto.ts`:

```typescript
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListUsersQueryDto extends PaginationDto {}
```

- [ ] **Step 3: Write the failing service test**

Add (or create) in `src/users/users.service.spec.ts`:

```typescript
  describe('list', () => {
    it('returns paginated users with only userId, email, role, departmentId — never passwordHash', async () => {
      prisma.appUser.findMany.mockResolvedValue([
        { userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null },
      ]);

      const result = await service.list({ page: 1, limit: 25 });

      expect(prisma.appUser.findMany).toHaveBeenCalledWith({
        select: { userId: true, email: true, role: true, departmentId: true },
        orderBy: { email: 'asc' },
        skip: 0,
        take: 25,
      });
      expect(result).toEqual([{ userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null }]);
    });
  });
```

(If `users.service.spec.ts` doesn't exist yet, create it with the same
`Test.createTestingModule`/mocked-`PrismaService` scaffold used
throughout this codebase, including this test plus the existing
`findByEmail`/`findById`/`updateRole` coverage — check whether those are
currently untested and if so include them too, matching this project's
standing full-coverage discipline.)

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- users.service.spec.ts`
Expected: FAIL — `service.list is not a function`

- [ ] **Step 5: Add `list` to `users.service.ts`**

Modify `src/users/users.service.ts` — add:

```typescript
export interface UserSummary {
  userId: string;
  email: string;
  role: string;
  departmentId: string | null;
}
```

```typescript
  async list(query: { page: number; limit: number }): Promise<UserSummary[]> {
    return this.prisma.appUser.findMany({
      select: { userId: true, email: true, role: true, departmentId: true },
      orderBy: { email: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- users.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing controller test, then add the endpoint**

Add to `src/users/users.controller.spec.ts` (create if needed, same
pattern):

```typescript
  it('list delegates to UsersService.list with the query, admin-only', async () => {
    const query = { page: 1, limit: 25 };
    const users = [{ userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null }];
    service.list.mockResolvedValue(users);

    const result = await controller.list(query as any);

    expect(service.list).toHaveBeenCalledWith(query);
    expect(result).toEqual(users);
  });
```

Run: `npm test -- users.controller.spec.ts` — expect FAIL, then modify
`src/users/users.controller.ts`:

```typescript
import { Get, Query } from '@nestjs/common';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
```

(merge `Get`, `Query` into the existing `@nestjs/common` import)

```typescript
  @Roles('admin')
  @Get()
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }
```

Run again: expect PASS.

- [ ] **Step 8: Write/extend an e2e test**

Create `test/users.e2e-spec.ts` (or add to an existing one if found):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-users-admin@sentinel.local';
  const officerEmail = 'e2e-users-officer@sentinel.local';
  let adminToken: string;
  let officerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.appUser.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' } });
    await prisma.appUser.create({ data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' } });

    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;
    const officerLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await app.close();
  });

  it('admin can list users, never seeing passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((u: any) => u.email === adminEmail)).toBe(true);
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });

  it('rejects a non-admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 9: Run the e2e test**

Run: `npm run test:e2e -- users.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 10: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 11: Frontend — replace the lookup-by-ID stopgap with a real table**

Modify `frontend/src/api/users.ts` — add:

```typescript
export interface UserSummary {
  userId: string
  email: string
  role: AppRole
  departmentId: string | null
}

export async function listUsers(query: { page?: number; limit?: number }): Promise<UserSummary[]> {
  const response = await apiClient.get<UserSummary[]>('/users', { params: query })
  return response.data
}
```

Modify `frontend/src/pages/settings/SettingsPage.tsx` — replace
`UserRoleLookup`'s single-ID form with a real paginated table (same
column/pagination pattern as `CameraListPage`): list of
`email | role | department`, each row's role editable inline via a
`<Select>` that calls the existing `updateUserRole` mutation on change,
with a success/error toast per row. Use `useQuery(['users', page])` +
the existing pagination UI pattern already built for cameras.

- [ ] **Step 12: Update `BACKEND_GAPS.md`**

Remove/resolve row #3.

- [ ] **Step 13: Manually verify against a live server**

Log in as admin, confirm Settings shows a real user table, change a test
user's role via the new UI, confirm it persists. Clean up any test users
created during verification. Stop both servers.

- [ ] **Step 14: Stop — do not commit**

---

## Task 4: Camera Network Fields (`ipAddress`/`rtspPort`/`streamPath`)

**Files:**
- Modify: `src/camera-registry/dto/update-camera.dto.ts`
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `test/camera-registry.e2e-spec.ts`

**Interfaces:**
- Produces: `UpdateCameraDto` gains `ipAddress?`, `rtspPort?`, `streamPath?`; `CameraRecord` gains the same three fields (readable, not just writable).

- [ ] **Step 1: Write the failing service test**

Add to `src/camera-registry/camera-registry.service.spec.ts`, inside the
existing `describe('applyCameraFieldChanges', ...)` block:

```typescript
    it('writes ipAddress, rtspPort, and streamPath when provided', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      const existing = { ...fakeCreatedRow, ip_address: null, rtsp_port: null, stream_path: null };
      // (adjust to however this file's fixtures shape CameraRecord — check
      // the actual mapRow output shape used elsewhere in this spec file
      // before writing this test, since fakeCreatedRow's exact fields may
      // differ from this sketch)

      const result = await service.applyCameraFieldChanges(
        'cam-1',
        { ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' },
        existing,
      );

      expect(result).not.toBeNull();
      expect(result?.after).toMatchObject({ ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' });
    });
```

**Before writing this test**, read the current
`camera-registry.service.spec.ts`'s `fakeCreatedRow`/`CameraRecord`
fixture shape exactly (it needs `ipAddress`/`rtspPort`/`streamPath`
fields added to it too, in this same task, or every existing test using
that fixture will start failing once `CameraRecord` gains the new
required-by-type fields) — add `ipAddress: null, rtspPort: null,
streamPath: null` to `fakeCreatedRow` and any other camera-record fixture
in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — new fields not recognized / result doesn't include them.

- [ ] **Step 3: Update `UpdateCameraDto`**

Modify `src/camera-registry/dto/update-camera.dto.ts` — add:

```typescript
import { IsIP, IsInt, Max, Min } from 'class-validator';
```

(merge into existing `class-validator` import)

```typescript
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  rtspPort?: number;

  @IsOptional()
  @IsString()
  streamPath?: string;
```

- [ ] **Step 4: Update `CameraRecord`, `RawCameraRow`, `mapRow`, `CAMERA_SELECT_SQL`, and `plainFieldMap`**

Modify `src/camera-registry/camera-registry.service.ts`:

Add to `CameraRecord` interface:
```typescript
  ipAddress: string | null;
  rtspPort: number | null;
  streamPath: string | null;
```

Add to `RawCameraRow` interface:
```typescript
  ip_address: string | null;
  rtsp_port: number | null;
  stream_path: string | null;
```

Add to `mapRow`:
```typescript
    ipAddress: row.ip_address,
    rtspPort: row.rtsp_port,
    streamPath: row.stream_path,
```

Add to `CAMERA_SELECT_SQL`'s column list (after `photo_url`, before
`current_status` — anywhere in the SELECT list works, just keep it
readable):
```sql
    ip_address, rtsp_port, stream_path,
```

Add three entries to `applyCameraFieldChanges`'s `plainFieldMap`:
```typescript
      ['ipAddress', 'ip_address'],
      ['rtspPort', 'rtsp_port'],
      ['streamPath', 'stream_path'],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests (existing + new) green — this step also proves
the existing tests didn't break from the fixture/interface change.

- [ ] **Step 6: Add an e2e test**

Add to `test/camera-registry.e2e-spec.ts`:

```typescript
  it('PATCH /cameras/:id can set ipAddress, rtspPort, and streamPath, readable back via GET', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Network Fields Camera', departmentId: DEPARTMENT_A_ID, latitude: 23.0, longitude: 72.0, cameraType: 'ip' });
    const cameraId = createResponse.body.cameraId;

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.ipAddress).toBe('10.0.0.5');
    expect(patchResponse.body.rtspPort).toBe(554);
    expect(patchResponse.body.streamPath).toBe('/stream1');

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/cameras/${cameraId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.body.ipAddress).toBe('10.0.0.5');
  });
```

(Match this test's variable names — `adminToken`, `DEPARTMENT_A_ID`,
cleanup helper — to whatever this existing e2e file actually uses; check
before inserting.)

- [ ] **Step 7: Run the e2e test**

Run: `npm run test:e2e -- camera-registry.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Run the FULL unit + e2e suites**

This task touches a widely-shared interface (`CameraRecord`) — run
`npm test` and `npm run test:e2e` in full (not just the touched files) to
catch any other test relying on the old `CameraRecord` shape (e.g.
scoring, health-monitoring, GIS tests that construct fake camera rows).
Fix any breakage before proceeding.

- [ ] **Step 9: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 10: Frontend — add network fields to the camera form**

Modify `frontend/src/types/api.ts` — add `ipAddress: string | null`,
`rtspPort: number | null`, `streamPath: string | null` to `CameraRecord`,
and `ipAddress?`, `rtspPort?`, `streamPath?` to `UpdateCameraPayload`
(via its existing `Partial<CreateCameraPayload>` — either add them to
`CreateCameraPayload` too if desired, or define `UpdateCameraPayload`
as its own type extending the partial with these edit-only fields; match
the design spec's "edit-only" decision — these should NOT be settable
via `CreateCameraPayload`/the create form).

Modify `frontend/src/pages/cameras/CameraFormPage.tsx` — in **edit mode
only** (`mode === 'edit'`), add a new collapsible "Network Configuration"
section (same collapsible pattern as "Add hardware details") with
`ipAddress`, `rtspPort`, `streamPath` fields, pre-filled from
`existingCamera.data` and included in the `payload` sent to
`updateMutation.mutateAsync`. Do not add these fields to create mode.

- [ ] **Step 11: Update `BACKEND_GAPS.md`**

Remove/resolve row #4 — note that the health-check cron can now actually
be exercised against a real camera once an officer sets its IP via edit.

- [ ] **Step 12: Manually verify against a live server**

Create a camera, edit it to add a real reachable local IP (or any IP) +
port, confirm it saves and displays correctly, confirm `GET
/health/:id/current` and the Health tab's "Check Now" now attempt a real
TCP check instead of falling back to manual-report mode. Clean up test
data. Stop both servers.

- [ ] **Step 13: Stop — do not commit**

---

## Task 5: `GET /vendor-lookup/brands`

**Files:**
- Modify: `src/scoring/scoring.controller.ts`
- Modify: `src/scoring/scoring.service.ts`
- Modify: `src/scoring/scoring.service.spec.ts`
- Modify: `src/scoring/scoring.controller.spec.ts`
- Modify: `test/scoring.e2e-spec.ts`

**Interfaces:**
- Produces: `ScoringService.listKnownBrands(): Promise<string[]>`, `GET /vendor-lookup/brands` → `200`, roles: admin, field_officer.

- [ ] **Step 1: Write the failing service test**

Add to `src/scoring/scoring.service.spec.ts`:

```typescript
  describe('listKnownBrands', () => {
    it('returns distinct brand names in alphabetical order', async () => {
      prisma.vendorLookup.findMany.mockResolvedValue([{ brand: 'Hikvision' }, { brand: 'Dahua' }]);

      const result = await service.listKnownBrands();

      expect(prisma.vendorLookup.findMany).toHaveBeenCalledWith({
        distinct: ['brand'],
        select: { brand: true },
        orderBy: { brand: 'asc' },
      });
      expect(result).toEqual(['Hikvision', 'Dahua']);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring.service.spec.ts`
Expected: FAIL — `service.listKnownBrands is not a function`

- [ ] **Step 3: Add `listKnownBrands` to `scoring.service.ts`**

Modify `src/scoring/scoring.service.ts` — add:

```typescript
  async listKnownBrands(): Promise<string[]> {
    const rows = await this.prisma.vendorLookup.findMany({
      distinct: ['brand'],
      select: { brand: true },
      orderBy: { brand: 'asc' },
    });
    return rows.map((row) => row.brand);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoring.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test, then add the endpoint**

Add to `src/scoring/scoring.controller.spec.ts`:

```typescript
  it('listBrands delegates to ScoringService.listKnownBrands', async () => {
    service.listKnownBrands = jest.fn().mockResolvedValue(['Hikvision']);

    const result = await controller.listBrands();

    expect(service.listKnownBrands).toHaveBeenCalledWith();
    expect(result).toEqual(['Hikvision']);
  });
```

Run: `npm test -- scoring.controller.spec.ts` — expect FAIL.

Modify `src/scoring/scoring.controller.ts` — add:

```typescript
  @Roles('admin', 'field_officer')
  @Get('vendor-lookup/brands')
  async listBrands() {
    return this.scoringService.listKnownBrands();
  }
```

**Route ordering note:** this is a `GET` under `/scoring`, alongside
`pending-verification` — no `:id`-style params in this controller collide
with a literal `vendor-lookup/brands` segment, so no reordering concerns
apply here (unlike the `bulk/:jobId` situations in other controllers).

Run again: expect PASS.

- [ ] **Step 6: Add an e2e test**

Add to `test/scoring.e2e-spec.ts`:

```typescript
  it('GET /scoring/vendor-lookup/brands returns distinct known brands', async () => {
    await prisma.vendorLookup.create({
      data: { brand: 'E2ETestBrandUnique', modelPattern: 'X%', onvifStatus: 'yes', sdkAvailable: true },
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/scoring/vendor-lookup/brands')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('E2ETestBrandUnique');

    await prisma.vendorLookup.deleteMany({ where: { brand: 'E2ETestBrandUnique' } });
  });
```

(Match `officerToken`/`prisma` variable names to whatever this existing
e2e file actually uses.)

- [ ] **Step 7: Run the e2e test**

Run: `npm run test:e2e -- scoring.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 9: Frontend — brand autocomplete**

Modify `frontend/src/api/scoring.ts` — add:

```typescript
export async function listKnownBrands(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/scoring/vendor-lookup/brands')
  return response.data
}
```

Modify `frontend/src/pages/cameras/CameraFormPage.tsx` — the Brand
`<Input>` in Section 3 becomes a simple `<datalist>`-backed autocomplete
(native HTML `<input list="brand-options">` + `<datalist id="brand-options">`,
the simplest correct implementation — no need for a heavier combobox
component for this): fetch known brands via
`useQuery(['scoring', 'brands'], scoringApi.listKnownBrands)` once on
mount, render each as a `<option>` inside the datalist. Typing still
works freely (a brand not in the list is still accepted — this is
suggestion, not restriction).

- [ ] **Step 10: Update `BACKEND_GAPS.md`**

Remove/resolve row #9.

- [ ] **Step 11: Manually verify against a live server**

Open the Add Camera form, expand Hardware Details, confirm typing in the
Brand field shows real known-brand suggestions from the database. Stop
both servers.

- [ ] **Step 12: Stop — do not commit**

---

## Task 6: `search` on `GET /cameras`

**Files:**
- Modify: `src/camera-registry/dto/camera-query.dto.ts`
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `test/camera-registry.e2e-spec.ts`

**Interfaces:**
- Produces: `CameraQueryDto.search?: string`, `listCameras`/`listCamerasUnpaginated` both honor it via `ILIKE` on `name`/`address_text`.

- [ ] **Step 1: Write the failing service test**

Add to `src/camera-registry/camera-registry.service.spec.ts`, inside
`describe('listCameras', ...)`:

```typescript
    it('applies a search filter across name and address_text when provided', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25, search: 'Main Gate' }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('ILIKE');
      expect(serializedQuery).toContain('Main Gate');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — no `ILIKE`/`search` term in the generated query.

- [ ] **Step 3: Add `search` to `CameraQueryDto`**

Modify `src/camera-registry/dto/camera-query.dto.ts` — add:

```typescript
  @IsOptional()
  @IsString()
  search?: string;
```

(add `IsString` to the existing `class-validator` import if not already there)

- [ ] **Step 4: Add the search condition to `listCameras` and `listCamerasUnpaginated`**

Modify `src/camera-registry/camera-registry.service.ts` — in both
methods' `conditions: Prisma.Sql[]` building logic, add:

```typescript
    if (scoped.search) {
      conditions.push(
        Prisma.sql`(name ILIKE ${'%' + scoped.search + '%'} OR address_text ILIKE ${'%' + scoped.search + '%'})`,
      );
    }
```

(Ensure `search` is included in the object passed to `applyDeptScope` in
both methods, same as every other filter field, so `scoped.search`
resolves correctly.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Add an e2e test**

Add to `test/camera-registry.e2e-spec.ts`:

```typescript
  it('GET /cameras?search= filters by name substring', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Searchable Unique Camera', departmentId: DEPARTMENT_A_ID, latitude: 23.0, longitude: 72.0, cameraType: 'ip' });

    const response = await request(app.getHttpServer())
      .get('/api/v1/cameras?search=Searchable Unique')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((c: any) => c.name === 'E2E Searchable Unique Camera')).toBe(true);
  });
```

- [ ] **Step 7: Run the e2e test**

Run: `npm run test:e2e -- camera-registry.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 9: Frontend — wire the real search param**

Modify `frontend/src/types/api.ts` — add `search?: string` to
`CameraListQuery`.

Modify `frontend/src/pages/cameras/CameraListPage.tsx` — add a real search
`<Input>` to the filter bar (debounced, same `useDebouncedValue` hook
already used in `CameraFormPage` for the scoring preview), include
`search` in the `query` object passed to `useCameraList`, removing any
prior "filters visible results only" framing/comment.

- [ ] **Step 10: Update `BACKEND_GAPS.md`**

Remove/resolve row #6.

- [ ] **Step 11: Manually verify against a live server**

Create a couple of test cameras with distinct names, confirm the search
box filters the real dataset (not just the currently-loaded page) as you
type. Clean up test data. Stop both servers.

- [ ] **Step 12: Stop — do not commit**

---

## Task 7: `POST /auth/change-password`

**Files:**
- Modify: `src/auth/auth.controller.ts`
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/refresh-token.service.ts`
- Modify: `src/auth/refresh-token.service.spec.ts`
- Modify: `src/auth/auth.service.spec.ts`
- Modify: `src/auth/auth.controller.spec.ts`
- Create: `src/auth/dto/change-password.dto.ts`
- Modify: `test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `RefreshTokenService.revokeAllForUser(userId): Promise<void>`, `AuthService.changePassword(userId, currentPassword, newPassword): Promise<void>`, `POST /auth/change-password` → `204`, roles: all authenticated.

- [ ] **Step 1: Write the failing test for `RefreshTokenService.revokeAllForUser`**

Add to `src/auth/refresh-token.service.spec.ts` (check the existing file's
mock/testing-module scaffold before inserting):

```typescript
  describe('revokeAllForUser', () => {
    it('marks every non-revoked refresh token for the user as revoked', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.revokeAllForUser('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- refresh-token.service.spec.ts`
Expected: FAIL — `service.revokeAllForUser is not a function`

- [ ] **Step 3: Add `revokeAllForUser` to `refresh-token.service.ts`**

Modify `src/auth/refresh-token.service.ts` — add:

```typescript
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- refresh-token.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write `change-password.dto.ts`**

Create `src/auth/dto/change-password.dto.ts`:

```typescript
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
```

- [ ] **Step 6: Write the failing test for `AuthService.changePassword`**

Add to `src/auth/auth.service.spec.ts`:

```typescript
  describe('changePassword', () => {
    it('updates the password hash and revokes all refresh tokens when the current password is correct', async () => {
      const correctHash = bcrypt.hashSync('old-password', 10);
      usersService.findById.mockResolvedValue({
        userId: 'user-1', email: 'a@b.com', role: 'admin', departmentId: null, passwordHash: correctHash,
      });

      await service.changePassword('user-1', 'old-password', 'new-password-123');

      expect(prisma.appUser.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { passwordHash: expect.any(String) },
      });
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('throws UnauthorizedException when currentPassword does not match', async () => {
      const correctHash = bcrypt.hashSync('old-password', 10);
      usersService.findById.mockResolvedValue({
        userId: 'user-1', email: 'a@b.com', role: 'admin', departmentId: null, passwordHash: correctHash,
      });

      await expect(service.changePassword('user-1', 'wrong-password', 'new-password-123')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
```

This requires the test file's `TestingModule` to also provide a mocked
`PrismaService` with `appUser.update` (check whether `AuthService`
already has direct `PrismaService` access — currently it likely doesn't,
only via `UsersService`; **this task adds a direct `PrismaService`
dependency to `AuthService`** since `UsersService` has no `updatePassword`
method and adding one there vs. directly in `AuthService` is a judgment
call — prefer adding a `UsersService.updatePasswordHash(userId, hash)`
method instead, to keep `AuthService` free of direct Prisma access,
consistent with how it currently only talks to `UsersService`/
`RefreshTokenService`, never `PrismaService` directly. Adjust the test
above to mock `usersService.updatePasswordHash` instead of
`prisma.appUser.update` if taking this route — **this is the recommended
approach**, matching the existing module boundary discipline documented
in this project's LLD ("modules must only interact with each other
through their exported service methods").

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- auth.service.spec.ts`
Expected: FAIL — `service.changePassword is not a function`

- [ ] **Step 8: Add `updatePasswordHash` to `UsersService`**

Modify `src/users/users.service.ts` — add:

```typescript
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.appUser.update({ where: { userId }, data: { passwordHash } });
  }
```

- [ ] **Step 9: Add `changePassword` to `AuthService`**

Modify `src/auth/auth.service.ts` — add:

```typescript
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordHash(userId, newHash);

    // Force re-authentication everywhere else — standard practice after a
    // password change, so a compromised old password can't keep a stale
    // session alive. The caller's own current access token remains valid
    // until its normal 15-minute expiry; their next refresh attempt will
    // correctly fail and prompt a fresh login with the new password.
    await this.refreshTokenService.revokeAllForUser(userId);
  }
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- auth.service.spec.ts`
Expected: PASS.

- [ ] **Step 11: Write the failing controller test, then add the endpoint**

Add to `src/auth/auth.controller.spec.ts`:

```typescript
  it('changePassword delegates to AuthService.changePassword with the current user id and dto fields', async () => {
    const currentUser = { userId: 'user-1', role: 'admin' as const, departmentId: null };
    const dto = { currentPassword: 'old', newPassword: 'new-password-123' };
    service.changePassword = jest.fn().mockResolvedValue(undefined);

    await controller.changePassword(currentUser, dto);

    expect(service.changePassword).toHaveBeenCalledWith('user-1', 'old', 'new-password-123');
  });
```

Run: `npm test -- auth.controller.spec.ts` — expect FAIL.

Modify `src/auth/auth.controller.ts` — add imports:

```typescript
import { HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ChangePasswordDto } from './dto/change-password.dto';
```

(merge into existing imports as needed)

```typescript
  @Audit('change_password', 'app_user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('change-password')
  async changePassword(@CurrentUser() currentUser: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(currentUser.userId, dto.currentPassword, dto.newPassword);
  }
```

**No `@Public()`** — this must require authentication, unlike `login`/`refresh`.

Run again: expect PASS.

- [ ] **Step 12: Add e2e tests**

Add to `test/auth.e2e-spec.ts`:

```typescript
  it('POST /auth/change-password updates the password and revokes existing refresh tokens', async () => {
    const email = 'e2e-change-password@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({ data: { email, passwordHash: await bcrypt.hash('OldPassword123!', 10), role: 'admin' } });

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'OldPassword123!' });
    const { accessToken, refreshToken } = login.body;

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword456!' });
    expect(changeResponse.status).toBe(204);

    // The old refresh token must now be dead.
    const refreshAfterChange = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(refreshAfterChange.status).toBe(401);

    // The new password must actually work for a fresh login.
    const reLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'NewPassword456!' });
    expect(reLogin.status).toBe(201);

    await prisma.appUser.deleteMany({ where: { email } });
  });

  it('POST /auth/change-password rejects an incorrect current password', async () => {
    const email = 'e2e-change-password-wrong@sentinel.local';
    await prisma.appUser.deleteMany({ where: { email } });
    await prisma.appUser.create({ data: { email, passwordHash: await bcrypt.hash('OldPassword123!', 10), role: 'admin' } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'OldPassword123!' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'WrongPassword', newPassword: 'NewPassword456!' });

    expect(response.status).toBe(401);
    await prisma.appUser.deleteMany({ where: { email } });
  });
```

- [ ] **Step 13: Run the e2e test**

Run: `npm run test:e2e -- auth.e2e-spec.ts`
Expected: PASS, all tests (existing + new) green — this is the step that
actually proves the revoke-all-sessions behavior works against a real
database, not just a mock.

- [ ] **Step 14: Run the FULL unit + e2e suites**

This task adds a new `UsersService` method other modules don't depend on,
but touches shared `AuthService`/`RefreshTokenService` — run the full
`npm test` and `npm run test:e2e` to confirm nothing else broke.

- [ ] **Step 15: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 16: Frontend — Change Password UI**

Modify `frontend/src/api/auth.ts` — add:

```typescript
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword })
}
```

Modify `frontend/src/pages/settings/SettingsPage.tsx` — add a new
"Change Password" section (below Account, above Appearance — or wherever
reads best) with three fields: Current Password, New Password, Confirm
New Password (client-side check that New and Confirm match before
submitting — a real `400`-equivalent UX guard, not a backend round-trip
for a typo). On success: clear the fields, show a success toast noting
"You'll need to sign in again on other devices." On `401`: show "Current
password is incorrect" inline, matching the real backend error. Since a
password change revokes all refresh tokens (including, eventually, the
current session's), consider: after a successful change, proactively call
`logout()` client-side and redirect to `/login` with a "Password
changed — please sign in again" message, rather than letting the user
continue until their access token silently fails 15 minutes later. This
is a UX decision worth making deliberately — the plan's default is to
redirect immediately, but flag it as a judgment call during
implementation, not a hard requirement.

- [ ] **Step 17: Update `BACKEND_GAPS.md`**

Remove/resolve row #7, and update its "Won't fix" status to reflect the
final built shape (authenticated change-password, not the originally
out-of-scope unauthenticated reset) — the row's description should
clarify this is intentionally NOT self-service account recovery for
locked-out users; that still requires the deferred email phase.

- [ ] **Step 18: Manually verify against a live server**

Log in as the test admin, open two "sessions" conceptually (or just note
the refresh token from login), change the password via Settings, confirm
old refresh token now fails `/auth/refresh`, confirm login works with the
new password, confirm the UI's post-change redirect-to-login behavior.
Reset the admin account back to its known password afterward (per the
earlier credential-handoff conversation) so the documented login
credentials keep working, or tell the user the credential changed. Stop
both servers.

- [ ] **Step 19: Stop — do not commit**

---

## Task 8: `GET /audit-log` (Read Endpoint)

**Files:**
- Create: `src/audit/audit.module.ts`
- Create: `src/audit/audit.controller.ts`
- Create: `src/audit/audit.service.ts`
- Create: `src/audit/audit.service.spec.ts`
- Create: `src/audit/audit.controller.spec.ts`
- Create: `src/audit/dto/audit-log-query.dto.ts`
- Create: `test/audit-log.e2e-spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `AuditService.list(query): Promise<{auditId, userId, action, entityType, metadata, createdAt}[]>`, `GET /audit-log` → `200`, roles: admin, auditor.
- Note: this is the module the design spec called "Section 3" and this
  plan's self-review caught as missing from the initial task breakdown —
  inserted here rather than renumbering Tasks 1-7.

- [ ] **Step 1: Write `audit-log-query.dto.ts`**

Create `src/audit/dto/audit-log-query.dto.ts`:

```typescript
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class AuditLogQueryDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
```

- [ ] **Step 2: Write the failing service test**

Create `src/audit/audit.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditLog: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  it('returns paginated audit log rows with no filters applied when none given', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.list({ page: 1, limit: 25 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
  });

  it('applies action, entityType, userId, and date-range filters when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);

    await service.list({
      page: 1,
      limit: 25,
      action: 'create_camera',
      entityType: 'camera',
      userId: 'user-1',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        action: 'create_camera',
        entityType: 'camera',
        userId: 'user-1',
        createdAt: { gte: new Date('2026-08-01'), lte: new Date('2026-08-31') },
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- audit.service.spec.ts`
Expected: FAIL — `Cannot find module './audit.service'`

- [ ] **Step 4: Write `audit.service.ts`**

Create `src/audit/audit.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuditLogQuery {
  page: number;
  limit: number;
  fromDate?: string;
  toDate?: string;
  action?: string;
  entityType?: string;
  userId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.userId) where.userId = query.userId;
    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- audit.service.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 6: Write the failing controller test**

Create `src/audit/audit.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();

    controller = module.get(AuditController);
  });

  it('list delegates to AuditService.list with the query', async () => {
    const query = { page: 1, limit: 25 };
    const rows = [{ auditId: 'audit-1' }];
    service.list.mockResolvedValue(rows);

    const result = await controller.list(query as any);

    expect(service.list).toHaveBeenCalledWith(query);
    expect(result).toEqual(rows);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- audit.controller.spec.ts`
Expected: FAIL — `Cannot find module './audit.controller'`

- [ ] **Step 8: Write `audit.controller.ts`**

Create `src/audit/audit.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Roles('admin', 'auditor')
  @Get()
  async list(@Query() query: AuditLogQueryDto) {
    return this.auditService.list(query);
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- audit.controller.spec.ts`
Expected: PASS.

- [ ] **Step 10: Create `audit.module.ts` and register in `app.module.ts`**

Create `src/audit/audit.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
```

Modify `src/app.module.ts` — add the import and add `AuditModule` to
`imports`. (This is a distinct module from the existing
`common/audit/write-audit-log-entry.ts` and
`common/interceptors/audit-log.interceptor.ts`, which stay exactly as
they are — this task only adds a read path, never touches the write
path.)

- [ ] **Step 11: Write the e2e test**

Create `test/audit-log.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Audit Log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-auditlog-admin@sentinel.local';
  const officerEmail = 'e2e-auditlog-officer@sentinel.local';
  let adminToken: string;
  let officerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.appUser.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' } });
    await prisma.appUser.create({ data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' } });

    const adminLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;
    const officerLogin = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: null, action: 'login' } }).catch(() => {});
    const users = await prisma.appUser.findMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.userId) } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
    await app.close();
  });

  it('admin can list audit log entries, including the login events just generated', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.some((row: any) => row.action === 'login')).toBe(true);
  });

  it('filters by action', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log?action=login')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.every((row: any) => row.action === 'login')).toBe(true);
  });

  it('rejects a field_officer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-log')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 12: Run the e2e test**

Run: `npm run test:e2e -- audit-log.e2e-spec.ts`
Expected: PASS, all 3 tests green — the first test's login events prove
the read endpoint sees real rows written by the existing, unmodified
write path (`AuditLogInterceptor` firing on the `login`-action route).

- [ ] **Step 13: Run `npx tsc --noEmit -p tsconfig.build.json`**

Expected: zero errors.

- [ ] **Step 14: Frontend — build the real Audit Log page**

Create `frontend/src/api/audit.ts`:

```typescript
import { apiClient } from './client'

export interface AuditLogEntry {
  auditId: string
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  metadata: { correlationId?: string; before?: Record<string, unknown>; after?: Record<string, unknown> } | null
  createdAt: string
}

export interface AuditLogQuery {
  page?: number
  limit?: number
  fromDate?: string
  toDate?: string
  action?: string
  entityType?: string
  userId?: string
}

export async function listAuditLog(query: AuditLogQuery): Promise<AuditLogEntry[]> {
  const response = await apiClient.get<AuditLogEntry[]>('/audit-log', { params: query })
  return response.data
}
```

Rewrite `frontend/src/pages/audit-log/AuditLogPage.tsx` — replace the
`<ComingSoon />` shell entirely with the real page per PRD Section 5.9:
filter bar (date range, action, entity type — plain text/date inputs,
matching the filter-bar visual pattern already established in
`CameraListPage`), a dense monospace-leaning table (columns: Timestamp
[absolute, monospace], Action [colored tag — reuse or extend
`StatusPill`'s tone system if a natural mapping exists, otherwise a
plain neutral tag], Entity Type + ID [monospace, clickable → deep-link to
`/cameras/:id` when `entityType === 'camera'`], Correlation ID [monospace,
with a copy-to-clipboard affordance]), and a click-to-expand inline diff
view rendering `metadata.before`/`metadata.after` as a simple two-column
field-by-field diff (field name → old value → new value) when present.
Empty state (no rows match filters) reuses the shared `<EmptyState />`
component, matching every other page's pattern — **do not introduce a
new empty-state visual style**, reuse what already exists.

Only render this page's route for `admin`/`auditor` — already enforced
by the existing `ProtectedRoute allowedRoles` wrapper in `App.tsx`, no
change needed there.

- [ ] **Step 15: Update `BACKEND_GAPS.md`**

Remove/resolve row #2 (both halves — the Audit Log Viewer page and the
Overview dashboard's "Recent Activity" panel, which can now optionally
be wired up too using the same `listAuditLog` call scoped to the last
~10 rows for the current user — implementer's call whether to include
this in this task or leave the Overview panel as a small separate
follow-up, since it wasn't in the original 7-gap scope the user
confirmed).

- [ ] **Step 16: Manually verify against a live server**

Log in as admin, perform a few real actions (create a camera, update it)
to generate fresh audit rows, navigate to Audit Log, confirm the real
rows appear with correct timestamps/actions, confirm filtering by action/
date range works against the real dataset, confirm clicking a row shows
the real before/after diff for the update action. Clean up test data.
Stop both servers.

- [ ] **Step 17: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only.

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every suite from this build plus every suite from every prior
build passes.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: all e2e suites pass, including all new ones from Tasks 1-8.

- [ ] **Step 3: Run the TypeScript compiler (backend)**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors.

- [ ] **Step 4: Run the TypeScript compiler (frontend)**

```bash
cd ../frontend
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Expected: zero errors, clean build.

- [ ] **Step 5: Full manual end-to-end walkthrough against live servers**

Start both servers. Using the real admin credentials (or a fresh test
account if the admin password was changed during Task 7's verification),
walk through every closed gap in one session: departments populate
everywhere from the real API, Settings shows real email + a real user
table + a working change-password flow, a camera's network fields can be
set and are used by health checks, brand autocomplete suggests real
vendor_lookup brands, camera search filters the real dataset, and the
Audit Log page shows real filterable rows with a working before/after
diff view. Clean up all test data created during this pass. Stop both
servers.

- [ ] **Step 6: Confirm `BACKEND_GAPS.md` accurately reflects final state**

Read through the file one more time — every gap this plan closed should
be removed or clearly marked resolved; #5, #7 (updated per Task 7), and
#8 should still accurately describe their settled/deferred status; no
stale references to endpoints that now exist should remain describing
them as missing.

- [ ] **Step 7: Stop — do not commit. Report completion to the user.**

Summarize: which gaps closed, exact test counts (backend unit + e2e,
frontend build status), and any judgment calls made during implementation
worth flagging (e.g. the post-password-change redirect behavior, the
`UsersService.updatePasswordHash` module-boundary decision).
