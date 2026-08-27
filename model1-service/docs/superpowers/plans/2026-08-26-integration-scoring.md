# Integration-Readiness Scoring (FR-3) + Photo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build FR-3 (Integration-Readiness Scoring: vendor-lookup fast path, AI-provider fallback, human verification queue) plus the minimal FR-2 slice it depends on (standalone camera photo upload).

**Architecture:** Two new modules — `scoring/` (score computation, AI provider) and `storage/` (Cloudinary photo storage) — plus one new endpoint on the existing `CameraRegistryController`. Both new external dependencies (AI, storage) sit behind injectable interfaces (`AiProvider`, `StorageProvider`) so vendors can be swapped without touching callers. Reuses established patterns throughout: raw-SQL `UPDATE` for camera field writes (matching `applyCameraFieldChanges`), `@Audit()` + `AuditContextService.setChanges()` for HTTP-request audit trails, `@Roles()` for RBAC.

**Tech Stack:** NestJS, Prisma (raw SQL for camera writes), `openai` npm SDK, `cloudinary` npm SDK, class-validator DTOs, Jest + Supertest for e2e.

**Spec:** `docs/superpowers/specs/2026-08-26-integration-scoring-design.md`

## Global Constraints

- AI vendor is OpenAI, model `gpt-4o-mini` (env: `OPENAI_API_KEY`, `OPENAI_MODEL`) — already updated in `.env`/`.env.example`/PRD Section 6a point 6.
- `AiProvider.guessOnvifSupport()`/`identifyFromPhoto()` return `null` on any failure (timeout/error/malformed response) — **never throw**. 8-second timeout, 1 retry with exponential backoff, then `null`.
- `integration_score` is **always derived** from `onvif_status`/`sdk_available` via the fixed formula below — no endpoint ever accepts it as direct input.
  ```
  onvif_status == 'yes'                        → 'easy'
  onvif_status == 'no' AND sdk_available        → 'medium'
  onvif_status == 'no' AND NOT sdk_available    → 'hard'
  onvif_status == 'unknown'                     → 'needs_verification'
  ```
- DB-enforced valid values (verified against live constraints — **note these differ from the earlier design spec's wording**):
  - `camera.onvif_status`: `'yes' | 'no' | 'unknown'`
  - `camera.onvif_source`: `'lookup_table' | 'ai_guess' | 'user_confirmed' | null` (NOT `'vendor_lookup'`/`'verified'` as drafted in the design spec — corrected here)
  - `camera.integration_score`: `'easy' | 'medium' | 'hard' | 'needs_verification'`
  - `camera.data_confidence`: `'verified_in_person' | 'verified_api' | 'self_reported'` (NOT `'verified'`/`'ai_estimated'` as drafted in the design spec — corrected here). Mapping used throughout this plan: vendor_lookup match → `'verified_api'`; AI guess, OCR result, or unknown fallback → `'self_reported'`.
  - `vendor_lookup.onvif_status`: `'yes' | 'no'` (no `'unknown'` — a lookup row is only ever created for a definite answer)
  - `vendor_lookup.source`: `'official_datasheet' | 'community' | 'ai_verified' | null`
  - `scoring_verification.status`: `'pending' | 'confirmed' | 'rejected'`
- All camera field writes (`onvif_status`, `integration_score`, `onvif_source`, `data_confidence`, `brand`, `model`, `photo_url`) go through raw SQL `$executeRaw`, matching the existing `applyCameraFieldChanges` pattern in `camera-registry.service.ts` — never a plain `prisma.camera.update()`, for consistency with how every other camera write in this codebase already works.
- Every HTTP-request endpoint that mutates a camera or `scoring_verification` uses `@Audit(action, entityType)` on the controller method + `auditContext.setChanges(request, before, after)` in the service — **not** a direct `writeAuditLogEntry()` call. (`writeAuditLogEntry()` is reserved for contexts with no live HTTP request, like the bulk-upload background job — none of this plan's endpoints run in that context.)
- Pagination: `GET /scoring/pending-verification` extends the existing `PaginationDto` (default 25, max 100) — same as `CameraQueryDto`.
- `AiProvider` and `StorageProvider` are mocked at the interface boundary in all unit/e2e tests — no real OpenAI/Cloudinary calls in automated tests.

---

## Task 1: Database — Prisma Client Regeneration Check

**Files:** none created or modified — verification only.

**Interfaces:**
- Consumes: existing `VendorLookup`, `ScoringVerification`, `Camera` Prisma models (already in `schema.prisma` and the live database from the earlier architecture-decision migration — no schema changes needed for this feature).

The `vendor_lookup` and `scoring_verification` tables and their Prisma models already exist (confirmed via `\d vendor_lookup` / `\d scoring_verification` against the live database and `prisma/schema.prisma`). This task only confirms the generated Prisma Client actually exposes them before any service code depends on it.

- [ ] **Step 1: Confirm the Prisma Client exposes both models**

```bash
cd model1-service
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(typeof p.vendorLookup.findMany, typeof p.scoringVerification.findMany);"
```

Expected: `function function`. If either prints `undefined`, run `npx prisma generate` and re-check — do not proceed to Task 2 until this passes.

- [ ] **Step 2: Stop — do not commit**

---

## Task 2: `AiProvider` Interface + `OpenAiProvider` Implementation

**Files:**
- Create: `src/scoring/providers/ai-provider.interface.ts`
- Create: `src/scoring/providers/ai-provider.token.ts`
- Create: `src/scoring/providers/openai.provider.ts`
- Create: `src/scoring/providers/openai.provider.spec.ts`

**Interfaces:**
- Produces: `AiProvider` interface, `AI_PROVIDER` injection token, `OpenAiProvider implements AiProvider`.
- Consumes: `openai` npm SDK (already installed), `ConfigService` (`@nestjs/config`, already used elsewhere in this codebase, e.g. `configuration.ts`'s `openai.apiKey`/`openai.model`).

- [ ] **Step 1: Write the interface and token (no test needed — pure type/const declarations)**

Create `src/scoring/providers/ai-provider.interface.ts`:

```typescript
export interface OnvifGuessResult {
  onvifSupported: 'yes' | 'no' | 'unsure';
  reasoning: string;
}

export interface PhotoIdentifyResult {
  brand: string | null;
  model: string | null;
}

// Vendor-swap boundary: ScoringService depends on this interface only,
// never on a concrete provider class. Both methods return null on any
// failure (timeout, API error, malformed response) rather than throwing —
// callers treat null as "fall back to unknown," which is how FR-3's
// "AI failure must never block scoring" requirement is satisfied
// structurally rather than via try/catch scattered at call sites.
export interface AiProvider {
  guessOnvifSupport(brand: string, model: string): Promise<OnvifGuessResult | null>;
  identifyFromPhoto(photoUrl: string): Promise<PhotoIdentifyResult | null>;
}
```

Create `src/scoring/providers/ai-provider.token.ts`:

```typescript
export const AI_PROVIDER = Symbol('AI_PROVIDER');
```

- [ ] **Step 2: Write the failing test for `guessOnvifSupport`**

Create `src/scoring/providers/openai.provider.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './openai.provider';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  };
});

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let config: ConfigService;

  beforeEach(() => {
    mockCreate.mockReset();
    config = {
      get: jest.fn((key: string) => {
        if (key === 'openai.apiKey') return 'test-key';
        if (key === 'openai.model') return 'gpt-4o-mini';
        return undefined;
      }),
    } as unknown as ConfigService;
    provider = new OpenAiProvider(config);
  });

  describe('guessOnvifSupport', () => {
    it('returns the parsed onvif guess on a successful call', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ onvif_supported: 'yes', reasoning: 'Known ONVIF-compliant line' }),
            },
          },
        ],
      });

      const result = await provider.guessOnvifSupport('Hikvision', 'DS-2CD2143G2-I');

      expect(result).toEqual({ onvifSupported: 'yes', reasoning: 'Known ONVIF-compliant line' });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('returns null when the API call rejects on both the initial attempt and the retry', async () => {
      mockCreate.mockRejectedValue(new Error('timeout'));

      const result = await provider.guessOnvifSupport('Unknown', 'X1');

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(2); // initial + 1 retry
    });

    it('returns null when the response content is not valid JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      });

      const result = await provider.guessOnvifSupport('Brand', 'Model');

      expect(result).toBeNull();
    });
  });

  describe('identifyFromPhoto', () => {
    it('returns the parsed brand/model on a successful call', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: JSON.stringify({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' }) },
          },
        ],
      });

      const result = await provider.identifyFromPhoto('https://res.cloudinary.com/demo/photo.jpg');

      expect(result).toEqual({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' });
    });

    it('returns null when the API call fails', async () => {
      mockCreate.mockRejectedValue(new Error('network error'));

      const result = await provider.identifyFromPhoto('https://res.cloudinary.com/demo/photo.jpg');

      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- openai.provider.spec.ts`
Expected: FAIL — `Cannot find module './openai.provider'`

- [ ] **Step 4: Write `openai.provider.ts`**

Create `src/scoring/providers/openai.provider.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiProvider, OnvifGuessResult, PhotoIdentifyResult } from './ai-provider.interface';

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 500;

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
      timeout: REQUEST_TIMEOUT_MS,
    });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o-mini';
  }

  async guessOnvifSupport(brand: string, model: string): Promise<OnvifGuessResult | null> {
    const prompt = `Does the camera model '${brand} ${model}' support ONVIF? Respond only as JSON: { "onvif_supported": "yes"|"no"|"unsure", "reasoning": string }`;

    const raw = await this.callWithRetry(prompt);
    if (raw === null) return null;

    try {
      const parsed = JSON.parse(raw) as { onvif_supported: 'yes' | 'no' | 'unsure'; reasoning: string };
      return { onvifSupported: parsed.onvif_supported, reasoning: parsed.reasoning };
    } catch {
      this.logger.error(`guessOnvifSupport: response was not valid JSON: ${raw}`);
      return null;
    }
  }

  async identifyFromPhoto(photoUrl: string): Promise<PhotoIdentifyResult | null> {
    const raw = await this.callWithRetry(
      'Identify the camera brand and model number visible in this photo. Respond only as JSON: { "brand": string|null, "model": string|null }',
      photoUrl,
    );
    if (raw === null) return null;

    try {
      const parsed = JSON.parse(raw) as { brand: string | null; model: string | null };
      return { brand: parsed.brand, model: parsed.model };
    } catch {
      this.logger.error(`identifyFromPhoto: response was not valid JSON: ${raw}`);
      return null;
    }
  }

  // Shared call helper: one retry with a fixed short backoff, then null.
  // A single retry (not the SDK's own retry option) keeps the total worst-
  // case latency close to 2x the timeout, not unboundedly larger.
  private async callWithRetry(prompt: string, imageUrl?: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = imageUrl
          ? [
              { type: 'text' as const, text: prompt },
              { type: 'image_url' as const, image_url: { url: imageUrl } },
            ]
          : prompt;

        const response = await this.client.chat.completions.create({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        });

        const text = response.choices[0]?.message?.content;
        if (!text) return null;
        return text;
      } catch (error) {
        this.logger.warn(
          `AI provider call failed (attempt ${attempt + 1}/2): ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- openai.provider.spec.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 6: Stop — do not commit**

---

## Task 3: `StorageProvider` Interface + `CloudinaryStorageProvider` Implementation

**Files:**
- Create: `src/storage/storage-provider.interface.ts`
- Create: `src/storage/storage-provider.token.ts`
- Create: `src/storage/cloudinary-storage.provider.ts`
- Create: `src/storage/cloudinary-storage.provider.spec.ts`
- Create: `src/storage/storage.module.ts`

**Interfaces:**
- Produces: `StorageProvider` interface, `STORAGE_PROVIDER` injection token, `CloudinaryStorageProvider implements StorageProvider`, `StorageModule`.
- Consumes: `cloudinary` npm SDK (already installed), `ConfigService` (`configuration.ts`'s `cloudinary.cloudName`/`cloudinary.apiKey`/`cloudinary.apiSecret`, already present).

- [ ] **Step 1: Write the interface and token**

Create `src/storage/storage-provider.interface.ts`:

```typescript
// Section 6a point 7's swap boundary: any future feature needing file
// storage depends on this interface, never on CloudinaryStorageProvider
// directly.
export interface StorageProvider {
  // Uploads a file buffer under the given logical key (e.g. a camera ID)
  // and returns its publicly-accessible URL.
  save(fileBuffer: Buffer, key: string): Promise<string>;
}
```

Create `src/storage/storage-provider.token.ts`:

```typescript
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
```

- [ ] **Step 2: Write the failing test**

Create `src/storage/cloudinary-storage.provider.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';

const mockUploadStream = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (...args: unknown[]) => mockUploadStream(...args),
    },
  },
}));

describe('CloudinaryStorageProvider', () => {
  let provider: CloudinaryStorageProvider;
  let config: ConfigService;

  beforeEach(() => {
    mockUploadStream.mockReset();
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'cloudinary.cloudName': 'test-cloud',
          'cloudinary.apiKey': 'test-key',
          'cloudinary.apiSecret': 'test-secret',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    provider = new CloudinaryStorageProvider(config);
  });

  it('resolves with the secure_url on a successful upload', async () => {
    mockUploadStream.mockImplementation((_options: unknown, callback: (error: unknown, result: unknown) => void) => {
      callback(null, { secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/cam-1.jpg' });
      return { end: jest.fn() };
    });

    const url = await provider.save(Buffer.from('fake image data'), 'cam-1');

    expect(url).toBe('https://res.cloudinary.com/test-cloud/image/upload/cam-1.jpg');
  });

  it('rejects when Cloudinary returns an error', async () => {
    mockUploadStream.mockImplementation((_options: unknown, callback: (error: unknown, result: unknown) => void) => {
      callback(new Error('upload failed'), null);
      return { end: jest.fn() };
    });

    await expect(provider.save(Buffer.from('fake image data'), 'cam-1')).rejects.toThrow('upload failed');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- cloudinary-storage.provider.spec.ts`
Expected: FAIL — `Cannot find module './cloudinary-storage.provider'`

- [ ] **Step 4: Write `cloudinary-storage.provider.ts`**

Create `src/storage/cloudinary-storage.provider.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { StorageProvider } from './storage-provider.interface';

@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
    });
  }

  save(fileBuffer: Buffer, key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { public_id: key, folder: 'sentinel-camera-photos', overwrite: true },
        (error, result) => {
          if (error || !result) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(fileBuffer);
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- cloudinary-storage.provider.spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 6: Create `storage.module.ts`**

Create `src/storage/storage.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.token';

@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: CloudinaryStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
```

- [ ] **Step 7: Stop — do not commit**

---

## Task 4: `ScoringService` — Vendor Lookup Fast Path + Score Computation Core

**Files:**
- Create: `src/scoring/scoring.service.ts`
- Create: `src/scoring/scoring.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AI_PROVIDER` token (`AiProvider`), `AuditContextService`.
- Produces: `ScoringService.lookupByBrandModel(cameraId, brand, model, request): Promise<ScoringResult>` — the shared core `/scoring/lookup` and the post-OCR half of `/scoring/lookup/photo` both call. `ScoringResult = { onvifStatus, integrationScore, onvifSource, dataConfidence }`. Also produces the internal `computeIntegrationScore(onvifStatus, sdkAvailable)` pure function (exported for reuse by Task 6's verify endpoint).

- [ ] **Step 1: Write the failing test for the vendor_lookup fast-path match**

Create `src/scoring/scoring.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { ScoringService, computeIntegrationScore } from './scoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { AI_PROVIDER } from './providers/ai-provider.token';
import { AiProvider } from './providers/ai-provider.interface';

describe('computeIntegrationScore', () => {
  it("returns 'easy' when onvifStatus is 'yes'", () => {
    expect(computeIntegrationScore('yes', false)).toBe('easy');
  });

  it("returns 'medium' when onvifStatus is 'no' and sdkAvailable is true", () => {
    expect(computeIntegrationScore('no', true)).toBe('medium');
  });

  it("returns 'hard' when onvifStatus is 'no' and sdkAvailable is false", () => {
    expect(computeIntegrationScore('no', false)).toBe('hard');
  });

  it("returns 'needs_verification' when onvifStatus is 'unknown'", () => {
    expect(computeIntegrationScore('unknown', false)).toBe('needs_verification');
  });
});

describe('ScoringService', () => {
  let service: ScoringService;
  let prisma: {
    camera: { findUnique: jest.Mock };
    vendorLookup: { findMany: jest.Mock };
    scoringVerification: { create: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let aiProvider: { guessOnvifSupport: jest.Mock; identifyFromPhoto: jest.Mock };
  let auditContext: { setChanges: jest.Mock };
  const fakeRequest = {} as Request;

  beforeEach(async () => {
    prisma = {
      camera: { findUnique: jest.fn() },
      vendorLookup: { findMany: jest.fn() },
      scoringVerification: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    aiProvider = { guessOnvifSupport: jest.fn(), identifyFromPhoto: jest.fn() };
    auditContext = { setChanges: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: PrismaService, useValue: prisma },
        { provide: AI_PROVIDER, useValue: aiProvider },
        { provide: AuditContextService, useValue: auditContext },
      ],
    }).compile();

    service = module.get(ScoringService);
  });

  describe('lookupByBrandModel', () => {
    it('throws NotFoundException when the camera does not exist', async () => {
      prisma.camera.findUnique.mockResolvedValue(null);

      await expect(
        service.lookupByBrandModel('missing-cam', 'Hikvision', 'DS-2CD', fakeRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('uses the vendor_lookup fast path on an exact brand + pattern match, without calling the AI provider', async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-1' });
      prisma.vendorLookup.findMany.mockResolvedValue([
        { brand: 'Hikvision', modelPattern: 'DS-2CD%', onvifStatus: 'yes', sdkAvailable: true },
      ]);

      const result = await service.lookupByBrandModel('cam-1', 'Hikvision', 'DS-2CD2143G2-I', fakeRequest);

      expect(result).toEqual({
        onvifStatus: 'yes',
        integrationScore: 'easy',
        onvifSource: 'lookup_table',
        dataConfidence: 'verified_api',
      });
      expect(aiProvider.guessOnvifSupport).not.toHaveBeenCalled();
      expect(prisma.scoringVerification.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        expect.any(Object),
        expect.objectContaining({ onvifStatus: 'yes', integrationScore: 'easy' }),
      );
    });

    it('falls back to the AI provider when no vendor_lookup row matches, and creates a pending scoring_verification row', async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-2' });
      prisma.vendorLookup.findMany.mockResolvedValue([]);
      aiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'yes', reasoning: 'Likely ONVIF-compliant' });
      prisma.scoringVerification.create.mockResolvedValue({ verificationId: 'ver-1' });

      const result = await service.lookupByBrandModel('cam-2', 'UnknownBrand', 'X1', fakeRequest);

      expect(result).toEqual({
        onvifStatus: 'yes',
        integrationScore: 'easy',
        onvifSource: 'ai_guess',
        dataConfidence: 'self_reported',
      });
      expect(prisma.scoringVerification.create).toHaveBeenCalledWith({
        data: {
          cameraId: 'cam-2',
          aiSuggestedOnvif: 'yes',
          aiConfidenceNote: 'Likely ONVIF-compliant',
          status: 'pending',
        },
      });
    });

    it("maps an AI 'unsure' response to onvifStatus 'unknown' and integrationScore 'needs_verification'", async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-3' });
      prisma.vendorLookup.findMany.mockResolvedValue([]);
      aiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'unsure', reasoning: 'Cannot determine' });
      prisma.scoringVerification.create.mockResolvedValue({ verificationId: 'ver-2' });

      const result = await service.lookupByBrandModel('cam-3', 'ObscureBrand', 'Z9', fakeRequest);

      expect(result.onvifStatus).toBe('unknown');
      expect(result.integrationScore).toBe('needs_verification');
    });

    it('falls back to unknown/needs_verification with no scoring_verification row when the AI provider fails', async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-4' });
      prisma.vendorLookup.findMany.mockResolvedValue([]);
      aiProvider.guessOnvifSupport.mockResolvedValue(null);

      const result = await service.lookupByBrandModel('cam-4', 'Brand', 'Model', fakeRequest);

      expect(result).toEqual({
        onvifStatus: 'unknown',
        integrationScore: 'needs_verification',
        onvifSource: null,
        dataConfidence: 'self_reported',
      });
      expect(prisma.scoringVerification.create).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring.service.spec.ts`
Expected: FAIL — `Cannot find module './scoring.service'`

- [ ] **Step 3: Write `scoring.service.ts`**

Create `src/scoring/scoring.service.ts`:

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { AI_PROVIDER } from './providers/ai-provider.token';
import { AiProvider } from './providers/ai-provider.interface';

export type OnvifStatus = 'yes' | 'no' | 'unknown';
export type IntegrationScore = 'easy' | 'medium' | 'hard' | 'needs_verification';
export type OnvifSource = 'lookup_table' | 'ai_guess' | 'user_confirmed' | null;
export type DataConfidence = 'verified_in_person' | 'verified_api' | 'self_reported';

export interface ScoringResult {
  onvifStatus: OnvifStatus;
  integrationScore: IntegrationScore;
  onvifSource: OnvifSource;
  dataConfidence: DataConfidence;
}

// Pure function, exported for reuse by the verify/reject endpoint (Task 6)
// — integration_score is always derived from these two inputs, never
// accepted as direct input on any endpoint.
export function computeIntegrationScore(
  onvifStatus: OnvifStatus,
  sdkAvailable: boolean,
): IntegrationScore {
  if (onvifStatus === 'yes') return 'easy';
  if (onvifStatus === 'no') return sdkAvailable ? 'medium' : 'hard';
  return 'needs_verification';
}

@Injectable()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly auditContext: AuditContextService,
  ) {}

  async lookupByBrandModel(
    cameraId: string,
    brand: string,
    model: string,
    request: Request,
  ): Promise<ScoringResult> {
    const camera = await this.prisma.camera.findUnique({ where: { cameraId } });
    if (!camera) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }

    const result = await this.resolveOnvifStatus(cameraId, brand, model);
    await this.writeResultToCamera(cameraId, result, request);
    return result;
  }

  private async resolveOnvifStatus(
    cameraId: string,
    brand: string,
    model: string,
  ): Promise<ScoringResult> {
    // Fast path: exact brand match, then pattern match against each
    // candidate's model_pattern (the wildcard lives in the stored value,
    // e.g. 'DS-2CD%' matching an input model of 'DS-2CD2143G2-I').
    const candidates = await this.prisma.vendorLookup.findMany({
      where: { brand: { equals: brand, mode: 'insensitive' } },
    });
    const match = candidates.find((row) => this.modelMatchesPattern(model, row.modelPattern));

    if (match) {
      const onvifStatus = match.onvifStatus as OnvifStatus;
      const sdkAvailable = match.sdkAvailable ?? false;
      return {
        onvifStatus,
        integrationScore: computeIntegrationScore(onvifStatus, sdkAvailable),
        onvifSource: 'lookup_table',
        dataConfidence: 'verified_api',
      };
    }

    const guess = await this.aiProvider.guessOnvifSupport(brand, model);
    if (!guess) {
      return {
        onvifStatus: 'unknown',
        integrationScore: 'needs_verification',
        onvifSource: null,
        dataConfidence: 'self_reported',
      };
    }

    const onvifStatus: OnvifStatus = guess.onvifSupported === 'unsure' ? 'unknown' : guess.onvifSupported;

    await this.prisma.scoringVerification.create({
      data: {
        cameraId,
        aiSuggestedOnvif: guess.onvifSupported,
        aiConfidenceNote: guess.reasoning,
        status: 'pending',
      },
    });

    return {
      onvifStatus,
      // The AI contract carries no SDK-availability signal, so an
      // AI-guess path can only ever resolve to 'easy', 'hard', or
      // 'needs_verification' — never 'medium'.
      integrationScore: computeIntegrationScore(onvifStatus, false),
      onvifSource: 'ai_guess',
      dataConfidence: 'self_reported',
    };
  }

  private modelMatchesPattern(model: string, pattern: string): boolean {
    // Convert a SQL LIKE-style pattern ('DS-2CD%') into a RegExp so the
    // same matching logic works in plain JS without a second DB round trip
    // per candidate row.
    const regex = new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i',
    );
    return regex.test(model);
  }

  private async writeResultToCamera(
    cameraId: string,
    result: ScoringResult,
    request: Request,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE camera
      SET onvif_status = ${result.onvifStatus},
          integration_score = ${result.integrationScore},
          onvif_source = ${result.onvifSource},
          data_confidence = ${result.dataConfidence},
          updated_at = now()
      WHERE camera_id = ${cameraId}::uuid
    `;

    this.auditContext.setChanges(
      request,
      {},
      {
        onvifStatus: result.onvifStatus,
        integrationScore: result.integrationScore,
        onvifSource: result.onvifSource,
        dataConfidence: result.dataConfidence,
      },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- scoring.service.spec.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Task 5: `POST /scoring/lookup` Endpoint

**Files:**
- Create: `src/scoring/dto/score-lookup.dto.ts`
- Create: `src/scoring/scoring.controller.ts`
- Create: `src/scoring/scoring.controller.spec.ts`
- Create: `src/scoring/scoring.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `ScoringService.lookupByBrandModel` (Task 4).
- Produces: `POST /scoring/lookup` → `200`, `ScoringResult` body.

- [ ] **Step 1: Write `score-lookup.dto.ts`**

Create `src/scoring/dto/score-lookup.dto.ts`:

```typescript
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ScoreLookupDto {
  @IsUUID()
  cameraId!: string;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;
}
```

- [ ] **Step 2: Write the failing controller test**

Create `src/scoring/scoring.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

describe('ScoringController', () => {
  let controller: ScoringController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { lookupByBrandModel: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScoringController],
      providers: [{ provide: ScoringService, useValue: service }],
    }).compile();

    controller = module.get(ScoringController);
  });

  it('lookup delegates to ScoringService.lookupByBrandModel with cameraId, brand, model, and request', async () => {
    const fakeRequest = {} as Request;
    const dto = { cameraId: 'cam-1', brand: 'Hikvision', model: 'DS-2CD' };
    const scoringResult = {
      onvifStatus: 'yes',
      integrationScore: 'easy',
      onvifSource: 'lookup_table',
      dataConfidence: 'verified_api',
    };
    service.lookupByBrandModel.mockResolvedValue(scoringResult);

    const result = await controller.lookup(fakeRequest, dto);

    expect(service.lookupByBrandModel).toHaveBeenCalledWith('cam-1', 'Hikvision', 'DS-2CD', fakeRequest);
    expect(result).toEqual(scoringResult);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scoring.controller.spec.ts`
Expected: FAIL — `Cannot find module './scoring.controller'`

- [ ] **Step 4: Write `scoring.controller.ts`**

Create `src/scoring/scoring.controller.ts`:

```typescript
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ScoringService } from './scoring.service';
import { ScoreLookupDto } from './dto/score-lookup.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Roles('admin', 'field_officer')
  @Audit('score_camera', 'camera')
  @Post('lookup')
  async lookup(@Req() request: Request, @Body() dto: ScoreLookupDto) {
    return this.scoringService.lookupByBrandModel(dto.cameraId, dto.brand, dto.model, request);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- scoring.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Create `scoring.module.ts`**

Create `src/scoring/scoring.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { OpenAiProvider } from './providers/openai.provider';
import { AI_PROVIDER } from './providers/ai-provider.token';
import { AuditContextModule } from '../common/context/audit-context.module';

@Module({
  imports: [AuditContextModule],
  controllers: [ScoringController],
  providers: [
    ScoringService,
    { provide: AI_PROVIDER, useClass: OpenAiProvider },
  ],
  exports: [ScoringService, AI_PROVIDER],
})
export class ScoringModule {}
```

- [ ] **Step 7: Register `ScoringModule` in `app.module.ts`**

Modify `src/app.module.ts` — add the import and add `ScoringModule` to the `imports` array (alongside `CameraRegistryModule`):

```typescript
import { ScoringModule } from './scoring/scoring.module';
```

```typescript
    CameraRegistryModule,
    ScoringModule,
```

- [ ] **Step 8: Run the full unit suite to confirm nothing broke**

Run: `npm test`
Expected: all suites pass, including the new ones.

- [ ] **Step 9: Stop — do not commit**

---

## Task 6: `GET /scoring/pending-verification` + `POST /scoring/verify/:verificationId`

**Files:**
- Create: `src/scoring/dto/verify-scoring.dto.ts`
- Create: `src/scoring/dto/pending-verification-query.dto.ts`
- Modify: `src/scoring/scoring.service.ts`
- Modify: `src/scoring/scoring.service.spec.ts`
- Modify: `src/scoring/scoring.controller.ts`
- Modify: `src/scoring/scoring.controller.spec.ts`

**Interfaces:**
- Produces: `ScoringService.listPendingVerifications(query): Promise<...>`, `ScoringService.verifyScoring(verificationId, decision, finalOnvifStatus, currentUser, request): Promise<...>`.
- Consumes: `computeIntegrationScore` (Task 4, same file).

- [ ] **Step 1: Write `verify-scoring.dto.ts`**

Create `src/scoring/dto/verify-scoring.dto.ts`:

```typescript
import { IsIn, IsOptional, ValidateIf } from 'class-validator';

const DECISIONS = ['confirm', 'reject'] as const;
const ONVIF_STATUSES = ['yes', 'no'] as const;

export class VerifyScoringDto {
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  // Required when decision === 'confirm', forbidden when decision === 'reject'
  // (validated explicitly in ScoringService.verifyScoring, since
  // class-validator's @ValidateIf can express "required if" but not cleanly
  // "forbidden if" with a clear error message).
  @ValidateIf((o: VerifyScoringDto) => o.decision === 'confirm')
  @IsIn(ONVIF_STATUSES)
  @IsOptional()
  finalOnvifStatus?: (typeof ONVIF_STATUSES)[number];
}
```

Create `src/scoring/dto/pending-verification-query.dto.ts`:

```typescript
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PendingVerificationQueryDto extends PaginationDto {}
```

- [ ] **Step 2: Write the failing tests for `listPendingVerifications` and `verifyScoring`**

Add to `src/scoring/scoring.service.spec.ts` — extend the `prisma` mock object in `beforeEach` with `scoringVerification: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() }` and `vendorLookup: { findMany: jest.fn(), create: jest.fn() }` (adding `create`/`findUnique`/`update`/`findMany` to the existing partial mocks), then add:

```typescript
  describe('listPendingVerifications', () => {
    it('returns pending scoring_verification rows joined with camera info', async () => {
      prisma.scoringVerification.findMany.mockResolvedValue([
        {
          verificationId: 'ver-1',
          cameraId: 'cam-1',
          aiSuggestedOnvif: 'yes',
          aiConfidenceNote: 'reasoning',
          status: 'pending',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          camera: { name: 'Camera A', brand: 'Hikvision', model: 'DS-2CD' },
        },
      ]);

      const result = await service.listPendingVerifications({ page: 1, limit: 25 });

      expect(result).toHaveLength(1);
      expect(prisma.scoringVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
          skip: 0,
          take: 25,
        }),
      );
    });
  });

  describe('verifyScoring', () => {
    const admin = { userId: 'admin-1', role: 'admin' as const, departmentId: null };

    it('throws NotFoundException when the verification row does not exist', async () => {
      prisma.scoringVerification.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyScoring('missing-ver', 'confirm', 'yes', admin, fakeRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the verification is not pending', async () => {
      prisma.scoringVerification.findUnique.mockResolvedValue({
        verificationId: 'ver-1',
        status: 'confirmed',
        cameraId: 'cam-1',
      });

      await expect(
        service.verifyScoring('ver-1', 'confirm', 'yes', admin, fakeRequest),
      ).rejects.toThrow(BadRequestException);
    });

    it('on confirm: updates the verification row, updates the camera, and inserts a vendor_lookup row', async () => {
      prisma.scoringVerification.findUnique.mockResolvedValue({
        verificationId: 'ver-1',
        status: 'pending',
        cameraId: 'cam-1',
      });
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-1', brand: 'Hikvision', model: 'DS-2CD2143G2-I' });
      prisma.scoringVerification.update.mockResolvedValue({});
      prisma.vendorLookup.create.mockResolvedValue({});

      const result = await service.verifyScoring('ver-1', 'confirm', 'yes', admin, fakeRequest);

      expect(prisma.scoringVerification.update).toHaveBeenCalledWith({
        where: { verificationId: 'ver-1' },
        data: expect.objectContaining({
          status: 'confirmed',
          verifiedBy: 'admin-1',
          finalOnvifStatus: 'yes',
        }),
      });
      expect(prisma.vendorLookup.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          brand: 'Hikvision',
          modelPattern: 'DS-2CD2143G2-I',
          onvifStatus: 'yes',
          source: 'ai_verified',
        }),
      });
      expect(prisma.$executeRaw).toHaveBeenCalled(); // camera write
      expect(result.status).toBe('confirmed');
    });

    it('on reject: updates the verification row only, no camera write, no vendor_lookup row', async () => {
      prisma.scoringVerification.findUnique.mockResolvedValue({
        verificationId: 'ver-2',
        status: 'pending',
        cameraId: 'cam-2',
      });
      prisma.scoringVerification.update.mockResolvedValue({});

      const executeRawCallsBefore = prisma.$executeRaw.mock.calls.length;

      const result = await service.verifyScoring('ver-2', 'reject', undefined, admin, fakeRequest);

      expect(prisma.scoringVerification.update).toHaveBeenCalledWith({
        where: { verificationId: 'ver-2' },
        data: expect.objectContaining({ status: 'rejected', verifiedBy: 'admin-1' }),
      });
      expect(prisma.vendorLookup.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw.mock.calls.length).toBe(executeRawCallsBefore);
      expect(result.status).toBe('rejected');
    });
  });
```

Also add `import { BadRequestException } from '@nestjs/common';` to the existing `@nestjs/common` import at the top of the spec file (merge with the existing `NotFoundException` import).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scoring.service.spec.ts`
Expected: FAIL — `service.listPendingVerifications is not a function` (and similar for `verifyScoring`).

- [ ] **Step 4: Add `listPendingVerifications` and `verifyScoring` to `scoring.service.ts`**

Modify `src/scoring/scoring.service.ts` — add `BadRequestException` to the `@nestjs/common` import, add an `AuthenticatedUser` import from `'../common/scoping/dept-scope.helper'`, and add these two methods after `lookupByBrandModel`:

```typescript
  async listPendingVerifications(query: { page: number; limit: number }) {
    const rows = await this.prisma.scoringVerification.findMany({
      where: { status: 'pending' },
      include: { camera: { select: { name: true, brand: true, model: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return rows.map((row) => ({
      verificationId: row.verificationId,
      cameraId: row.cameraId,
      cameraName: row.camera.name,
      brand: row.camera.brand,
      model: row.camera.model,
      aiSuggestedOnvif: row.aiSuggestedOnvif,
      aiConfidenceNote: row.aiConfidenceNote,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  async verifyScoring(
    verificationId: string,
    decision: 'confirm' | 'reject',
    finalOnvifStatus: 'yes' | 'no' | undefined,
    currentUser: AuthenticatedUser,
    request: Request,
  ): Promise<{ verificationId: string; status: string }> {
    const verification = await this.prisma.scoringVerification.findUnique({
      where: { verificationId },
    });
    if (!verification) {
      throw new NotFoundException(`Scoring verification ${verificationId} not found`);
    }
    if (verification.status !== 'pending') {
      throw new BadRequestException(
        `Scoring verification ${verificationId} has already been ${verification.status}`,
      );
    }

    if (decision === 'reject') {
      await this.prisma.scoringVerification.update({
        where: { verificationId },
        data: { status: 'rejected', verifiedBy: currentUser.userId, verifiedAt: new Date() },
      });
      this.auditContext.setChanges(
        request,
        { status: 'pending' },
        { status: 'rejected' },
      );
      return { verificationId, status: 'rejected' };
    }

    // decision === 'confirm' — finalOnvifStatus is guaranteed present by
    // VerifyScoringDto's validation.
    const camera = await this.prisma.camera.findUnique({ where: { cameraId: verification.cameraId } });
    if (!camera) {
      throw new NotFoundException(`Camera ${verification.cameraId} not found`);
    }

    const onvifStatus = finalOnvifStatus as OnvifStatus;
    const integrationScore = computeIntegrationScore(onvifStatus, false);

    await this.prisma.scoringVerification.update({
      where: { verificationId },
      data: {
        status: 'confirmed',
        verifiedBy: currentUser.userId,
        verifiedAt: new Date(),
        finalOnvifStatus,
      },
    });

    await this.prisma.$executeRaw`
      UPDATE camera
      SET onvif_status = ${onvifStatus},
          integration_score = ${integrationScore},
          onvif_source = 'user_confirmed',
          updated_at = now()
      WHERE camera_id = ${verification.cameraId}::uuid
    `;

    if (camera.brand && camera.model) {
      await this.prisma.vendorLookup.create({
        data: {
          brand: camera.brand,
          modelPattern: camera.model,
          onvifStatus,
          source: 'ai_verified',
        },
      });
    }

    this.auditContext.setChanges(
      request,
      { status: 'pending' },
      { status: 'confirmed', onvifStatus, integrationScore },
    );

    return { verificationId, status: 'confirmed' };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- scoring.service.spec.ts`
Expected: PASS, all tests green (9 from Task 4 + 5 new = 14).

- [ ] **Step 6: Write the failing controller tests**

Add to `src/scoring/scoring.controller.spec.ts`:

```typescript
  it('listPendingVerifications delegates to ScoringService.listPendingVerifications with the query', async () => {
    const query = { page: 1, limit: 25 };
    const rows = [{ verificationId: 'ver-1' }];
    service.listPendingVerifications = jest.fn().mockResolvedValue(rows);

    const result = await controller.listPendingVerifications(query as any);

    expect(service.listPendingVerifications).toHaveBeenCalledWith(query);
    expect(result).toEqual(rows);
  });

  it('verify delegates to ScoringService.verifyScoring with all fields', async () => {
    const fakeRequest = {} as Request;
    const currentUser = { userId: 'admin-1', role: 'admin' as const, departmentId: null };
    const dto = { decision: 'confirm' as const, finalOnvifStatus: 'yes' as const };
    const verifyResult = { verificationId: 'ver-1', status: 'confirmed' };
    service.verifyScoring = jest.fn().mockResolvedValue(verifyResult);

    const result = await controller.verify(fakeRequest, 'ver-1', dto, currentUser);

    expect(service.verifyScoring).toHaveBeenCalledWith(
      'ver-1',
      'confirm',
      'yes',
      currentUser,
      fakeRequest,
    );
    expect(result).toEqual(verifyResult);
  });
```

Add the necessary imports to the top of the spec (`AuthenticatedUser` type from `'../common/scoping/dept-scope.helper'` — used inline via `as const`, no new import needed beyond what's already there for `Request`).

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- scoring.controller.spec.ts`
Expected: FAIL — `controller.listPendingVerifications is not a function`.

- [ ] **Step 8: Add the two endpoints to `scoring.controller.ts`**

Modify `src/scoring/scoring.controller.ts` — add imports (`Get`, `Param`, `Query` to the `@nestjs/common` import; `PendingVerificationQueryDto`, `VerifyScoringDto`; `CurrentUser` decorator; `AuthenticatedUser` type):

```typescript
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ScoringService } from './scoring.service';
import { ScoreLookupDto } from './dto/score-lookup.dto';
import { VerifyScoringDto } from './dto/verify-scoring.dto';
import { PendingVerificationQueryDto } from './dto/pending-verification-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';
```

Add the two methods after `lookup`:

```typescript
  @Roles('admin')
  @Get('pending-verification')
  async listPendingVerifications(@Query() query: PendingVerificationQueryDto) {
    return this.scoringService.listPendingVerifications(query);
  }

  @Roles('admin')
  @Audit('verify_scoring', 'scoring_verification')
  @Post('verify/:verificationId')
  async verify(
    @Req() request: Request,
    @Param('verificationId') verificationId: string,
    @Body() dto: VerifyScoringDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.scoringService.verifyScoring(
      verificationId,
      dto.decision,
      dto.finalOnvifStatus,
      currentUser,
      request,
    );
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- scoring.controller.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 10: Run the TypeScript compiler**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: zero errors.

- [ ] **Step 11: Stop — do not commit**

---

## Task 7: `POST /cameras/:id/photo` — Photo Upload Endpoint

**Files:**
- Modify: `src/camera-registry/camera-registry.service.ts`
- Modify: `src/camera-registry/camera-registry.service.spec.ts`
- Modify: `src/camera-registry/camera-registry.controller.ts`
- Modify: `src/camera-registry/camera-registry.controller.spec.ts`
- Modify: `src/camera-registry/camera-registry.module.ts`

**Interfaces:**
- Consumes: `STORAGE_PROVIDER` token (`StorageProvider`, Task 3).
- Produces: `CameraRegistryService.updateCameraPhoto(request, cameraId, fileBuffer, currentUser): Promise<CameraRecord>`, `POST /cameras/:id/photo` → `200`, updated `CameraRecord`.

- [ ] **Step 1: Write the failing service test**

Add to `src/camera-registry/camera-registry.service.spec.ts` — a new `describe('updateCameraPhoto', ...)` block placed after the existing `describe('applyCameraFieldChanges', ...)` block. First, the test file's `TestingModule` setup needs a `storageProvider` mock added; check the existing `beforeEach` and extend it with:

```typescript
    storageProvider = { save: jest.fn() };
```

(declared as `let storageProvider: { save: jest.Mock };` alongside the other `let` declarations at the top of the describe block), and add `{ provide: STORAGE_PROVIDER, useValue: storageProvider }` to the `TestingModule`'s `providers` array (alongside the existing `PrismaService`/`AuditContextService` providers), plus the imports — merge `BadGatewayException` into the file's existing `import { BadRequestException, NotFoundException } from '@nestjs/common';` line, and add:

```typescript
import { STORAGE_PROVIDER } from '../storage/storage-provider.token';
```

Then add the test block:

```typescript
  describe('updateCameraPhoto', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const fakeRequest = {} as Request;

    it('uploads the file via StorageProvider, writes photo_url, and records an audit change', async () => {
      prisma.$queryRaw.mockResolvedValue([{ ...fakeCreatedRow, photo_url: null }]);
      storageProvider.save.mockResolvedValue('https://res.cloudinary.com/test/cam-1.jpg');
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.updateCameraPhoto(
        fakeRequest,
        'cam-1',
        Buffer.from('fake image'),
        admin,
      );

      expect(storageProvider.save).toHaveBeenCalledWith(Buffer.from('fake image'), 'cam-1');
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { photoUrl: null },
        { photoUrl: 'https://res.cloudinary.com/test/cam-1.jpg' },
      );
      expect(result.cameraId).toBe('cam-1');
    });

    it('throws NotFoundException when the camera does not exist', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.updateCameraPhoto(fakeRequest, 'missing-cam', Buffer.from('x'), admin),
      ).rejects.toThrow(NotFoundException);
      expect(storageProvider.save).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when the storage provider upload fails', async () => {
      prisma.$queryRaw.mockResolvedValue([{ ...fakeCreatedRow, photo_url: null }]);
      storageProvider.save.mockRejectedValue(new Error('Cloudinary is down'));

      await expect(
        service.updateCameraPhoto(fakeRequest, 'cam-1', Buffer.from('x'), admin),
      ).rejects.toThrow(BadGatewayException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });
```

(This assumes the existing spec file already declares `let prisma`, `let auditContext` mocks reused across describe blocks per the established pattern in this file — confirm by reading the file's top-level `beforeEach` before inserting; adjust variable names only if they differ from `prisma`/`auditContext`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: FAIL — `service.updateCameraPhoto is not a function`.

- [ ] **Step 3: Add `updateCameraPhoto` to `camera-registry.service.ts`**

Modify `src/camera-registry/camera-registry.service.ts`:
- Add `BadGatewayException`, `Inject` to the `@nestjs/common` import.
- Add `import { STORAGE_PROVIDER } from '../storage/storage-provider.token';` and `import type { StorageProvider } from '../storage/storage-provider.interface';`.
- Add `@Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,` to the constructor (alongside `prisma` and `auditContext`).
- Add this method after `softDeleteCamera`:

```typescript
  async updateCameraPhoto(
    request: Request,
    cameraId: string,
    fileBuffer: Buffer,
    currentUser: AuthenticatedUser,
  ): Promise<CameraRecord> {
    const existing = await this.getCameraById(cameraId, currentUser);

    // Unlike the AI provider, there's no meaningful "unknown" fallback for
    // "the photo didn't get stored" — this endpoint's entire job is the
    // upload, so a storage failure must be visible to the caller, not
    // silently swallowed. Wrapped explicitly as BadGatewayException rather
    // than left to bubble up as a generic 500.
    let photoUrl: string;
    try {
      photoUrl = await this.storageProvider.save(fileBuffer, cameraId);
    } catch (error) {
      throw new BadGatewayException(
        `Failed to upload photo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.prisma.$executeRaw`
      UPDATE camera SET photo_url = ${photoUrl}, updated_at = now() WHERE camera_id = ${cameraId}::uuid
    `;

    this.auditContext.setChanges(request, { photoUrl: existing.photoUrl }, { photoUrl });

    const updated = await this.findCameraRow(cameraId);
    if (!updated) {
      throw new Error(`Camera ${cameraId} was updated but could not be re-read`);
    }
    return updated;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- camera-registry.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Write the failing controller test**

Add to `src/camera-registry/camera-registry.controller.spec.ts` — extend the `service` mock in `beforeEach` with `updateCameraPhoto: jest.fn()`, then add:

```typescript
  it('uploadPhoto delegates to CameraRegistryService.updateCameraPhoto with the request, id, file buffer, and current user', async () => {
    const fakeRequest = {} as any;
    const fakeFile = { buffer: Buffer.from('fake image') } as Express.Multer.File;
    const updatedCamera = { cameraId: 'cam-1', photoUrl: 'https://res.cloudinary.com/test/cam-1.jpg' };
    service.updateCameraPhoto.mockResolvedValue(updatedCamera);

    const result = await controller.uploadPhoto(fakeRequest, 'cam-1', fakeFile, currentUser);

    expect(service.updateCameraPhoto).toHaveBeenCalledWith(fakeRequest, 'cam-1', fakeFile.buffer, currentUser);
    expect(result).toEqual(updatedCamera);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: FAIL — `controller.uploadPhoto is not a function`.

- [ ] **Step 7: Add the `uploadPhoto` endpoint**

Modify `src/camera-registry/camera-registry.controller.ts` — add `@Audit('update_camera', 'camera')` and a `POST /cameras/:id/photo` endpoint after `update`:

```typescript
  @Roles('admin', 'field_officer')
  @Audit('update_camera', 'camera')
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/photo')
  async uploadPhoto(
    @Req() request: Request,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.cameraRegistryService.updateCameraPhoto(request, id, file.buffer, currentUser);
  }
```

**Route ordering note:** `POST :id/photo` is a `POST`, and the existing `bulk/:jobId`/`export` ordering concerns only apply within the same HTTP method's `GET` routes — `PATCH :id` and `DELETE :id` already coexist safely with this pattern since NestJS matches per-method, not globally. No reordering needed, but verify in the final file that no other `POST` route uses a conflicting pattern.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- camera-registry.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Update `camera-registry.module.ts` to import `StorageModule`**

Modify `src/camera-registry/camera-registry.module.ts` — add `import { StorageModule } from '../storage/storage.module';` and add `StorageModule` to the `imports` array:

```typescript
  imports: [AuditContextModule, StorageModule],
```

- [ ] **Step 10: Run the TypeScript compiler**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: zero errors.

- [ ] **Step 11: Stop — do not commit**

---

## Task 8: `POST /scoring/lookup/photo` — OCR Endpoint

**Files:**
- Create: `src/scoring/dto/score-lookup-photo.dto.ts`
- Modify: `src/scoring/scoring.service.ts`
- Modify: `src/scoring/scoring.service.spec.ts`
- Modify: `src/scoring/scoring.controller.ts`
- Modify: `src/scoring/scoring.controller.spec.ts`
- Modify: `src/scoring/scoring.module.ts`

**Interfaces:**
- Consumes: `ScoringService.lookupByBrandModel` (Task 4, called internally after a successful OCR identify), `AiProvider.identifyFromPhoto` (Task 2).
- Produces: `ScoringService.lookupByPhoto(cameraId, request): Promise<{ identified: boolean; brand?: string; model?: string } & Partial<ScoringResult>>`, `POST /scoring/lookup/photo` → `200`.

- [ ] **Step 1: Write `score-lookup-photo.dto.ts`**

Create `src/scoring/dto/score-lookup-photo.dto.ts`:

```typescript
import { IsUUID } from 'class-validator';

export class ScoreLookupPhotoDto {
  @IsUUID()
  cameraId!: string;
}
```

- [ ] **Step 2: Write the failing test for `lookupByPhoto`**

Add to `src/scoring/scoring.service.spec.ts` a new `describe('lookupByPhoto', ...)` block. This requires the `prisma.camera.findUnique` mock (already present from Task 4's tests) to also be usable for a camera-with-photo-url scenario:

```typescript
  describe('lookupByPhoto', () => {
    it('throws BadRequestException when the camera has no photo_url', async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-1', photoUrl: null });

      await expect(service.lookupByPhoto('cam-1', fakeRequest)).rejects.toThrow(BadRequestException);
      expect(aiProvider.identifyFromPhoto).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the camera does not exist', async () => {
      prisma.camera.findUnique.mockResolvedValue(null);

      await expect(service.lookupByPhoto('missing-cam', fakeRequest)).rejects.toThrow(NotFoundException);
    });

    it('on a successful identify, writes brand/model to the camera and runs the full lookup flow', async () => {
      prisma.camera.findUnique
        .mockResolvedValueOnce({ cameraId: 'cam-1', photoUrl: 'https://res.cloudinary.com/test/cam-1.jpg' })
        .mockResolvedValueOnce({ cameraId: 'cam-1' }); // second call inside lookupByBrandModel
      aiProvider.identifyFromPhoto.mockResolvedValue({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' });
      prisma.vendorLookup.findMany.mockResolvedValue([
        { brand: 'Hikvision', modelPattern: 'DS-2CD%', onvifStatus: 'yes', sdkAvailable: true },
      ]);

      const result = await service.lookupByPhoto('cam-1', fakeRequest);

      expect(result).toEqual(
        expect.objectContaining({
          identified: true,
          brand: 'Hikvision',
          model: 'DS-2CD2143G2-I',
          onvifStatus: 'yes',
          integrationScore: 'easy',
        }),
      );
      // Two $executeRaw calls: one for the brand/model write, one from
      // lookupByBrandModel's writeResultToCamera.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('returns identified:false and falls back to unknown when OCR cannot identify the camera', async () => {
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-2',
        photoUrl: 'https://res.cloudinary.com/test/cam-2.jpg',
      });
      aiProvider.identifyFromPhoto.mockResolvedValue({ brand: null, model: null });

      const result = await service.lookupByPhoto('cam-2', fakeRequest);

      expect(result).toEqual({
        identified: false,
        onvifStatus: 'unknown',
        integrationScore: 'needs_verification',
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // only the unknown-fallback camera write
    });

    it('returns identified:false when the AI provider call itself fails', async () => {
      prisma.camera.findUnique.mockResolvedValue({
        cameraId: 'cam-3',
        photoUrl: 'https://res.cloudinary.com/test/cam-3.jpg',
      });
      aiProvider.identifyFromPhoto.mockResolvedValue(null);

      const result = await service.lookupByPhoto('cam-3', fakeRequest);

      expect(result.identified).toBe(false);
    });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scoring.service.spec.ts`
Expected: FAIL — `service.lookupByPhoto is not a function`.

- [ ] **Step 4: Add `lookupByPhoto` to `scoring.service.ts`**

Modify `src/scoring/scoring.service.ts` — add this method after `lookupByBrandModel`:

```typescript
  async lookupByPhoto(
    cameraId: string,
    request: Request,
  ): Promise<{ identified: boolean; brand?: string; model?: string } & Partial<ScoringResult>> {
    const camera = await this.prisma.camera.findUnique({ where: { cameraId } });
    if (!camera) {
      throw new NotFoundException(`Camera ${cameraId} not found`);
    }
    if (!camera.photoUrl) {
      throw new BadRequestException(
        `Camera ${cameraId} has no photo — upload one first via POST /cameras/:id/photo`,
      );
    }

    const identified = await this.aiProvider.identifyFromPhoto(camera.photoUrl);

    if (!identified || !identified.brand || !identified.model) {
      await this.prisma.$executeRaw`
        UPDATE camera
        SET onvif_status = 'unknown',
            integration_score = 'needs_verification',
            data_confidence = 'self_reported',
            updated_at = now()
        WHERE camera_id = ${cameraId}::uuid
      `;
      return { identified: false, onvifStatus: 'unknown', integrationScore: 'needs_verification' };
    }

    await this.prisma.$executeRaw`
      UPDATE camera SET brand = ${identified.brand}, model = ${identified.model}, updated_at = now()
      WHERE camera_id = ${cameraId}::uuid
    `;

    const scoringResult = await this.lookupByBrandModel(cameraId, identified.brand, identified.model, request);

    return { identified: true, brand: identified.brand, model: identified.model, ...scoringResult };
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- scoring.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Write the failing controller test**

Add to `src/scoring/scoring.controller.spec.ts`:

```typescript
  it('lookupByPhoto delegates to ScoringService.lookupByPhoto with cameraId and request', async () => {
    const fakeRequest = {} as Request;
    const dto = { cameraId: 'cam-1' };
    const lookupResult = { identified: true, brand: 'Hikvision', model: 'DS-2CD', onvifStatus: 'yes' as const };
    service.lookupByPhoto = jest.fn().mockResolvedValue(lookupResult);

    const result = await controller.lookupByPhoto(fakeRequest, dto);

    expect(service.lookupByPhoto).toHaveBeenCalledWith('cam-1', fakeRequest);
    expect(result).toEqual(lookupResult);
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test -- scoring.controller.spec.ts`
Expected: FAIL — `controller.lookupByPhoto is not a function`.

- [ ] **Step 8: Add the `lookupByPhoto` endpoint**

Modify `src/scoring/scoring.controller.ts` — add `import { ScoreLookupPhotoDto } from './dto/score-lookup-photo.dto';` and this method after `lookup`:

```typescript
  @Roles('admin', 'field_officer')
  @Audit('score_camera', 'camera')
  @Post('lookup/photo')
  async lookupByPhoto(@Req() request: Request, @Body() dto: ScoreLookupPhotoDto) {
    return this.scoringService.lookupByPhoto(dto.cameraId, request);
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- scoring.controller.spec.ts`
Expected: PASS.

- [ ] **Step 10: Run the TypeScript compiler**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: zero errors.

- [ ] **Step 11: Stop — do not commit**

---

## Task 9: End-to-End Tests

**Files:**
- Create: `test/scoring.e2e-spec.ts`
- Create: `test/camera-photo-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: the full scoring + photo-upload flow (Tasks 2-8). Overrides `AI_PROVIDER` and `STORAGE_PROVIDER` with fake in-memory implementations via `overrideProvider` in the `TestingModule` builder, so these tests run without real OpenAI/Cloudinary credentials.

- [ ] **Step 1: Write `test/scoring.e2e-spec.ts`**

Create `test/scoring.e2e-spec.ts`. Follows the same structure as `test/camera-bulk-upload.e2e-spec.ts` (real department IDs, `cleanup()` helper, `beforeAll`/`afterAll`), using `overrideProvider(AI_PROVIDER)` to inject a fake `AiProvider`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AI_PROVIDER } from '../src/scoring/providers/ai-provider.token';
import { AiProvider } from '../src/scoring/providers/ai-provider.interface';

describe('Scoring (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-scoring-admin@sentinel.local';
  const officerEmail = 'e2e-scoring-officer@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let officerToken: string;
  let fakeAiProvider: jest.Mocked<AiProvider>;

  async function cleanup() {
    const users = await prisma.appUser.findMany({
      where: { email: { in: [adminEmail, officerEmail] } },
    });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    const cameras = await prisma.camera.findMany({ where: { name: { startsWith: 'E2E Scoring Camera' } } });
    const cameraIds = cameras.map((c) => c.cameraId);
    if (cameraIds.length > 0) {
      await prisma.scoringVerification.deleteMany({ where: { cameraId: { in: cameraIds } } });
    }
    await prisma.vendorLookup.deleteMany({ where: { brand: 'E2ETestBrand' } });
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Scoring Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, officerEmail] } } });
  }

  beforeAll(async () => {
    fakeAiProvider = {
      guessOnvifSupport: jest.fn(),
      identifyFromPhoto: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(fakeAiProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await cleanup();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });
    await prisma.appUser.create({
      data: { email: officerEmail, passwordHash: await bcrypt.hash(password, 10), role: 'field_officer' },
    });

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.accessToken;

    const officerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: officerEmail, password });
    officerToken = officerLogin.body.accessToken;
  });

  afterEach(() => {
    fakeAiProvider.guessOnvifSupport.mockReset();
    fakeAiProvider.identifyFromPhoto.mockReset();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function createTestCamera(name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, departmentId: DEPARTMENT_A_ID, latitude: 23.0, longitude: 72.0, cameraType: 'ip' });
    return response.body.cameraId;
  }

  it('uses the vendor_lookup fast path when a matching row exists, without calling the AI provider', async () => {
    await prisma.vendorLookup.create({
      data: { brand: 'E2ETestBrand', modelPattern: 'FastPath%', onvifStatus: 'yes', sdkAvailable: true },
    });
    const cameraId = await createTestCamera('E2E Scoring Camera Fast Path');

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'E2ETestBrand', model: 'FastPath-100' });

    expect(response.status).toBe(201);
    expect(response.body.onvifStatus).toBe('yes');
    expect(response.body.integrationScore).toBe('easy');
    expect(response.body.onvifSource).toBe('lookup_table');
    expect(fakeAiProvider.guessOnvifSupport).not.toHaveBeenCalled();
  });

  it('falls back to the AI provider and creates a pending verification when no vendor_lookup match exists', async () => {
    const cameraId = await createTestCamera('E2E Scoring Camera AI Path');
    fakeAiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'no', reasoning: 'Not a known ONVIF line' });

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'SomeUnknownBrand', model: 'X1' });

    expect(response.status).toBe(201);
    expect(response.body.onvifStatus).toBe('no');
    expect(response.body.onvifSource).toBe('ai_guess');

    const pending = await prisma.scoringVerification.findMany({ where: { cameraId } });
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('admin can list pending verifications and confirm one, writing a new vendor_lookup row', async () => {
    const cameraId = await createTestCamera('E2E Scoring Camera Confirm Flow');
    fakeAiProvider.guessOnvifSupport.mockResolvedValue({ onvifSupported: 'yes', reasoning: 'Confident guess' });
    await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ cameraId, brand: 'E2ETestBrand', model: 'ConfirmFlow-1' });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/scoring/pending-verification')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    const entry = listResponse.body.find((v: any) => v.cameraId === cameraId);
    expect(entry).toBeDefined();

    const verifyResponse = await request(app.getHttpServer())
      .post(`/api/v1/scoring/verify/${entry.verificationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'confirm', finalOnvifStatus: 'yes' });

    expect(verifyResponse.status).toBe(201);
    expect(verifyResponse.body.status).toBe('confirmed');

    const camera = await prisma.camera.findUnique({ where: { cameraId } });
    expect(camera?.onvifSource).toBe('user_confirmed');

    const vendorLookupRow = await prisma.vendorLookup.findFirst({
      where: { brand: 'E2ETestBrand', modelPattern: 'ConfirmFlow-1' },
    });
    expect(vendorLookupRow).toBeDefined();
    expect(vendorLookupRow?.source).toBe('ai_verified');
  });

  it('rejects pending-verification list access for a field_officer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/scoring/pending-verification')
      .set('Authorization', `Bearer ${officerToken}`);

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the scoring e2e test**

Run: `npm run test:e2e -- scoring.e2e-spec.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 3: Write `test/camera-photo-upload.e2e-spec.ts`**

Create `test/camera-photo-upload.e2e-spec.ts`, using `overrideProvider(STORAGE_PROVIDER)` to avoid a real Cloudinary call, and `overrideProvider(AI_PROVIDER)` similarly for the OCR-after-upload test:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STORAGE_PROVIDER } from '../src/storage/storage-provider.token';
import { StorageProvider } from '../src/storage/storage-provider.interface';
import { AI_PROVIDER } from '../src/scoring/providers/ai-provider.token';
import { AiProvider } from '../src/scoring/providers/ai-provider.interface';

describe('Camera Photo Upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'CorrectHorseBatteryStaple123!';
  const adminEmail = 'e2e-photo-admin@sentinel.local';
  const DEPARTMENT_A_ID = 'c4cedd68-5fca-4a1f-b6bd-b607e0840436'; // HOME

  let adminToken: string;
  let fakeStorageProvider: jest.Mocked<StorageProvider>;
  let fakeAiProvider: jest.Mocked<AiProvider>;

  async function cleanup() {
    const users = await prisma.appUser.findMany({ where: { email: adminEmail } });
    const userIds = users.map((u) => u.userId);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.camera.deleteMany({ where: { name: { startsWith: 'E2E Photo Camera' } } });
    await prisma.appUser.deleteMany({ where: { email: adminEmail } });
  }

  beforeAll(async () => {
    fakeStorageProvider = { save: jest.fn() };
    fakeAiProvider = { guessOnvifSupport: jest.fn(), identifyFromPhoto: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(fakeStorageProvider)
      .overrideProvider(AI_PROVIDER)
      .useValue(fakeAiProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['livez'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    await cleanup();

    await prisma.appUser.create({
      data: { email: adminEmail, passwordHash: await bcrypt.hash(password, 10), role: 'admin' },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('uploads a photo, sets camera.photo_url, and the photo is then usable by the OCR lookup endpoint', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Photo Camera 1',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });
    const cameraId = createResponse.body.cameraId;

    fakeStorageProvider.save.mockResolvedValue('https://res.cloudinary.com/fake/cam.jpg');

    const uploadResponse = await request(app.getHttpServer())
      .post(`/api/v1/cameras/${cameraId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('fake image bytes'), 'label.jpg');

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.photoUrl).toBe('https://res.cloudinary.com/fake/cam.jpg');

    fakeAiProvider.identifyFromPhoto.mockResolvedValue({ brand: 'Hikvision', model: 'DS-2CD2143G2-I' });

    const ocrResponse = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup/photo')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cameraId });

    expect(ocrResponse.status).toBe(201);
    expect(ocrResponse.body.identified).toBe(true);
    expect(ocrResponse.body.brand).toBe('Hikvision');
  });

  it('rejects OCR lookup with 400 when the camera has no photo yet', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Photo Camera No Photo',
        departmentId: DEPARTMENT_A_ID,
        latitude: 23.0,
        longitude: 72.0,
        cameraType: 'ip',
      });

    const response = await request(app.getHttpServer())
      .post('/api/v1/scoring/lookup/photo')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cameraId: createResponse.body.cameraId });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run the photo upload e2e test**

Run: `npm run test:e2e -- camera-photo-upload.e2e-spec.ts`
Expected: PASS, both tests green.

- [ ] **Step 5: Stop — do not commit**

---

## Final Task: Full Regression Pass

**Files:** none created — verification only.

- [ ] **Step 1: Run the entire unit test suite**

```bash
cd model1-service
npm test
```

Expected: every suite from this build plus every suite from every prior build passes.

- [ ] **Step 2: Run the entire e2e test suite**

```bash
npm run test:e2e
```

Expected: all e2e suites pass, including the two new ones from Task 9.

- [ ] **Step 3: Run the TypeScript compiler**

```bash
npx tsc --noEmit -p tsconfig.build.json
```

Expected: zero errors.

- [ ] **Step 4: Manually verify the vendor_lookup fast path end to end**

```bash
npm run start:dev
```

Seed one `vendor_lookup` row via psql, create a test camera, call `POST /scoring/lookup` with a matching brand/model, confirm the camera's `onvif_status`/`integration_score`/`onvif_source` update correctly and no `scoring_verification` row is created. Clean up test data. Stop the dev server.

**Note:** `OPENAI_API_KEY` in `.env` is currently empty, so the AI-guess path and OCR path cannot be manually verified against a real OpenAI call in this pass — only the vendor_lookup fast path (which never calls the AI provider) can be exercised live. The AI-dependent paths are covered by the e2e tests in Task 9 via a fake `AiProvider`, which is sufficient verification for this plan; flag to the user that a real OpenAI key would be needed for a live manual check of those paths specifically.

- [ ] **Step 5: Stop — do not commit. Report completion to the user.**

Summarize: what was built (vendor-lookup fast-path scoring, OpenAI-backed AI fallback with pending-verification queue, confirm/reject workflow that feeds back into vendor_lookup, Cloudinary photo upload, OCR-based brand/model identification), what passed (exact test counts), and flag that live OpenAI verification is blocked on an API key the user needs to supply.
