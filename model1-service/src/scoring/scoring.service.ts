import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { AI_PROVIDER } from './providers/ai-provider.token';
import type { AiProvider } from './providers/ai-provider.interface';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

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

// Pure function, exported for reuse by the verify/reject endpoint —
// integration_score is always derived from these two inputs, never
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
    await this.writeResultToCamera(cameraId, brand, model, result, request);
    return result;
  }

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
        verificationId,
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
      verificationId,
    );

    return { verificationId, status: 'confirmed' };
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
    brand: string,
    model: string,
    result: ScoringResult,
    request: Request,
  ): Promise<void> {
    // Persisting brand/model here (not just the scoring fields) ensures
    // verifyScoring can always find a brand/model on the camera later to
    // create a new vendor_lookup row from on confirm — regardless of
    // whether the pending guess came from a typed-in lookup or an OCR
    // identify (which separately writes the same fields before calling
    // this method via lookupByBrandModel).
    await this.prisma.$executeRaw`
      UPDATE camera
      SET brand = ${brand},
          model = ${model},
          onvif_status = ${result.onvifStatus},
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
        brand,
        model,
        onvifStatus: result.onvifStatus,
        integrationScore: result.integrationScore,
        onvifSource: result.onvifSource,
        dataConfidence: result.dataConfidence,
      },
      cameraId,
    );
  }

  // Powers the Add/Edit Camera form's brand autocomplete — a suggestion
  // list, not a restriction, so this deliberately doesn't validate input
  // brands against it.
  async listKnownBrands(): Promise<string[]> {
    const rows = await this.prisma.vendorLookup.findMany({
      distinct: ['brand'],
      select: { brand: true },
      orderBy: { brand: 'asc' },
    });
    return rows.map((row) => row.brand);
  }
}
