import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { ScoringService, computeIntegrationScore } from './scoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { AI_PROVIDER } from './providers/ai-provider.token';

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
    vendorLookup: { findMany: jest.Mock; create: jest.Mock };
    scoringVerification: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let aiProvider: { guessOnvifSupport: jest.Mock; identifyFromPhoto: jest.Mock };
  let auditContext: { setChanges: jest.Mock };
  const fakeRequest = {} as Request;

  beforeEach(async () => {
    prisma = {
      camera: { findUnique: jest.fn() },
      vendorLookup: { findMany: jest.fn(), create: jest.fn() },
      scoringVerification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
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
        'cam-1',
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

    it('writes the given brand/model onto the camera alongside the scoring fields', async () => {
      prisma.camera.findUnique.mockResolvedValue({ cameraId: 'cam-5' });
      prisma.vendorLookup.findMany.mockResolvedValue([
        { brand: 'Hikvision', modelPattern: 'DS-2CD%', onvifStatus: 'yes', sdkAvailable: true },
      ]);

      await service.lookupByBrandModel('cam-5', 'Hikvision', 'DS-2CD2143G2-I', fakeRequest);

      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('brand');
      expect(serializedQuery).toContain('model');
    });
  });

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
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { status: 'pending' },
        expect.objectContaining({ status: 'confirmed' }),
        'ver-1',
      );
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
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { status: 'pending' },
        { status: 'rejected' },
        'ver-2',
      );
    });
  });

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
});
