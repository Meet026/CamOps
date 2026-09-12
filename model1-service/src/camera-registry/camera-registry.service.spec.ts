import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { CameraRegistryService } from './camera-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContextService } from '../common/context/audit-context.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';
import { STORAGE_PROVIDER } from '../storage/storage-provider.token';

describe('CameraRegistryService', () => {
  let service: CameraRegistryService;
  let prisma: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let auditContext: { setChanges: jest.Mock };
  let storageProvider: { save: jest.Mock };

  const fakeCreatedRow = {
    camera_id: 'cam-1',
    department_id: 'dept-1',
    name: 'Main Gate Camera',
    address_text: null,
    camera_type: 'ip',
    brand: null,
    model: null,
    onvif_status: 'unknown',
    onvif_source: null,
    integration_score: 'needs_verification',
    data_confidence: 'self_reported',
    photo_url: null,
    current_status: 'unknown',
    installed_at: null,
    is_active: true,
    created_by: 'user-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    longitude: 72.5714,
    latitude: 23.0225,
    ip_address: null,
    rtsp_port: null,
    stream_path: null,
  };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    auditContext = { setChanges: jest.fn() };
    storageProvider = { save: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CameraRegistryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditContextService, useValue: auditContext },
        { provide: STORAGE_PROVIDER, useValue: storageProvider },
      ],
    }).compile();

    service = module.get(CameraRegistryService);
  });

  describe('createCamera', () => {
    const dto = {
      name: 'Main Gate Camera',
      departmentId: 'dept-1',
      latitude: 23.0225,
      longitude: 72.5714,
      cameraType: 'ip' as const,
    };
    const fakeRequest = {} as Request;

    it('runs an INSERT then a SELECT, and returns the mapped camelCase record', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ camera_id: 'cam-1' }])
        .mockResolvedValueOnce([fakeCreatedRow]);

      const result = await service.createCamera(fakeRequest, dto, 'user-1');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        cameraId: 'cam-1',
        departmentId: 'dept-1',
        name: 'Main Gate Camera',
        addressText: null,
        cameraType: 'ip',
        brand: null,
        model: null,
        onvifStatus: 'unknown',
        onvifSource: null,
        integrationScore: 'needs_verification',
        dataConfidence: 'self_reported',
        photoUrl: null,
        currentStatus: 'unknown',
        installedAt: null,
        isActive: true,
        createdBy: 'user-1',
        createdAt: fakeCreatedRow.created_at,
        updatedAt: fakeCreatedRow.updated_at,
        longitude: 72.5714,
        latitude: 23.0225,
        ipAddress: null,
        rtspPort: null,
        streamPath: null,
      });
    });

    it('translates a departmentId foreign-key violation into a BadRequestException', async () => {
      const fkError = Object.assign(
        new Error(
          'insert or update on table "camera" violates foreign key constraint "camera_department_id_fkey"',
        ),
        {
          code: 'P2010',
          meta: {
            code: '23503',
            message:
              'insert or update on table "camera" violates foreign key constraint "camera_department_id_fkey"',
          },
        },
      );
      prisma.$queryRaw.mockRejectedValueOnce(fkError);

      await expect(service.createCamera(fakeRequest, dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('records a before:null/after:{fields} change with the new camera as entityId', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ camera_id: 'cam-1' }])
        .mockResolvedValueOnce([fakeCreatedRow]);

      await service.createCamera(fakeRequest, dto, 'user-1');

      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        null,
        expect.objectContaining({ name: 'Main Gate Camera', departmentId: 'dept-1' }),
        'cam-1',
      );
    });

    it('does not call setChanges when called with no request (e.g. the bulk-upload background job)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ camera_id: 'cam-1' }])
        .mockResolvedValueOnce([fakeCreatedRow]);

      await service.createCamera(undefined, dto, 'user-1');

      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });
  });

  describe('listCameras', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const deptViewer: AuthenticatedUser = {
      userId: 'user-2',
      role: 'dept_viewer',
      departmentId: 'dept-1',
    };

    const rawRow = { ...fakeCreatedRow };

    it('returns all cameras with no filters when isActive is omitted (default 25/page 1)', async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.listCameras({ page: 1, limit: 25 }, admin);

      expect(result).toHaveLength(1);
      expect(result[0].cameraId).toBe('cam-1');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("scopes the query to the dept_viewer's own department, ignoring any departmentId they pass", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras(
        { page: 1, limit: 25, departmentId: 'attacker-dept' } as any,
        deptViewer,
      );

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('dept-1');
      expect(serializedQuery).not.toContain('attacker-dept');
    });

    it('does not scope the query for an admin (no WHERE clause at all when no filters given)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      // CAMERA_SELECT_SQL's own column list always contains "department_id"
      // (it's a selected column), so the real signal that no filter was
      // applied is the absence of a WHERE clause entirely, not the column
      // name's absence.
      expect(serializedQuery).not.toContain('WHERE');
    });

    it('applies the isActive=true filter when explicitly requested', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25, isActive: true }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('is_active');
    });

    it('omits the isActive filter entirely when not provided (no WHERE clause)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      // Same reasoning as the admin-scoping test above: "is_active" is
      // always present as a selected column, so check for the absent
      // WHERE clause instead of the column name.
      expect(serializedQuery).not.toContain('WHERE');
    });

    it('applies pagination as LIMIT/OFFSET', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 3, limit: 10 }, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('LIMIT');
      expect(serializedQuery).toContain('OFFSET');
    });

    it('applies a search filter across name and address_text when provided', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.listCameras({ page: 1, limit: 25, search: 'Main Gate' } as any, admin);

      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('ILIKE');
      expect(serializedQuery).toContain('Main Gate');
    });
  });

  describe('listCamerasUnpaginated', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };

    it('returns all matching rows with no LIMIT/OFFSET in the query', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      const result = await service.listCamerasUnpaginated({ isActive: true }, admin);

      expect(result).toHaveLength(1);
      const [sqlFragment] = prisma.$queryRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).not.toContain('LIMIT');
    });
  });

  describe('getCameraById', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const deptViewer: AuthenticatedUser = {
      userId: 'user-2',
      role: 'dept_viewer',
      departmentId: 'dept-1',
    };

    const rawRow = { ...fakeCreatedRow };

    it('returns the camera when found and the caller is not scoped', async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.getCameraById('cam-1', admin);

      expect(result.cameraId).toBe('cam-1');
    });

    it("returns the camera when found and it belongs to the dept_viewer's own department", async () => {
      prisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.getCameraById('cam-1', deptViewer);

      expect(result.cameraId).toBe('cam-1');
    });

    it('throws NotFoundException when the camera does not exist at all', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getCameraById('nonexistent', admin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException (never a different error) when a dept_viewer requests a camera in a different department', async () => {
      const rowInOtherDept = { ...rawRow, department_id: 'dept-999' };
      prisma.$queryRaw.mockResolvedValue([rowInOtherDept]);

      await expect(service.getCameraById('cam-1', deptViewer)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateCamera', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const fakeRequest = {} as Request;

    const existingRow = { ...fakeCreatedRow, name: 'Old Name' };

    it('updates a plain field, leaving location untouched, and records before/after', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow]) // before-read via getCameraById
        .mockResolvedValueOnce([{ ...existingRow, name: 'New Name' }]); // after-read
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.updateCamera(fakeRequest, 'cam-1', { name: 'New Name' }, admin);

      expect(result.name).toBe('New Name');
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { name: 'Old Name' },
        { name: 'New Name' },
        'cam-1',
      );
    });

    it('updates location when both latitude and longitude are provided', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([{ ...existingRow, latitude: 24.0, longitude: 73.0 }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(
        fakeRequest,
        'cam-1',
        { latitude: 24.0, longitude: 73.0 },
        admin,
      );

      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).toContain('location_geo');
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { latitude: 23.0225, longitude: 72.5714 },
        { latitude: 24.0, longitude: 73.0 },
        'cam-1',
      );
    });

    it('does not touch location_geo in the SQL when no coordinates are provided', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([{ ...existingRow, name: 'New Name' }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(fakeRequest, 'cam-1', { name: 'New Name' }, admin);

      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      const serializedQuery = JSON.stringify(sqlFragment);
      expect(serializedQuery).not.toContain('location_geo');
    });

    it('does not call setChanges when the update contains no actual field changes', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([existingRow])
        .mockResolvedValueOnce([existingRow]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateCamera(fakeRequest, 'cam-1', { name: 'Old Name' }, admin);

      expect(auditContext.setChanges).not.toHaveBeenCalled();
    });

    it('throws NotFoundException before attempting any write when the camera does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.updateCamera(fakeRequest, 'nonexistent', { name: 'New Name' }, admin),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('applyCameraFieldChanges', () => {
    const existingRow = {
      ...fakeCreatedRow,
      name: 'Old Name',
      ipAddress: null,
      rtspPort: null,
      streamPath: null,
    };

    it('writes ipAddress, rtspPort, and streamPath when provided', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.applyCameraFieldChanges(
        'cam-1',
        { ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' },
        existingRow,
      );

      expect(result).toEqual({
        before: { ipAddress: null, rtspPort: null, streamPath: null },
        after: { ipAddress: '10.0.0.5', rtspPort: 554, streamPath: '/stream1' },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('returns before/after and writes the DB when a plain field changes', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.applyCameraFieldChanges('cam-1', { name: 'New Name' }, existingRow);

      expect(result).toEqual({ before: { name: 'Old Name' }, after: { name: 'New Name' } });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('includes location_geo in the write when both latitude and longitude change', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.applyCameraFieldChanges(
        'cam-1',
        { latitude: 24.0, longitude: 73.0 },
        existingRow,
      );

      expect(result).toEqual({
        before: { latitude: 23.0225, longitude: 72.5714 },
        after: { latitude: 24.0, longitude: 73.0 },
      });
      const [sqlFragment] = prisma.$executeRaw.mock.calls[0];
      expect(JSON.stringify(sqlFragment)).toContain('location_geo');
    });

    it('returns null and writes nothing when the dto contains no actual changes', async () => {
      const result = await service.applyCameraFieldChanges('cam-1', { name: 'Old Name' }, existingRow);

      expect(result).toBeNull();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('findCameraRecordById', () => {
    it('returns the mapped camera record with no scoping check applied', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeCreatedRow]);

      const result = await service.findCameraRecordById('cam-1');

      expect(result?.cameraId).toBe('cam-1');
    });

    it('returns null when the camera does not exist (no exception thrown)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.findCameraRecordById('nonexistent');

      expect(result).toBeNull();
    });
  });

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
        'cam-1',
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

  describe('softDeleteCamera', () => {
    const admin: AuthenticatedUser = { userId: 'user-1', role: 'admin', departmentId: null };
    const fakeRequest = {} as Request;

    const activeRow = { ...fakeCreatedRow };

    it('sets isActive to false via a plain Prisma update and records before/after', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([activeRow]);
      (prisma as any).camera = { update: jest.fn().mockResolvedValue({}) };

      await service.softDeleteCamera(fakeRequest, 'cam-1', admin);

      expect((prisma as any).camera.update).toHaveBeenCalledWith({
        where: { cameraId: 'cam-1' },
        data: { isActive: false },
      });
      expect(auditContext.setChanges).toHaveBeenCalledWith(
        fakeRequest,
        { isActive: true },
        { isActive: false },
        'cam-1',
      );
    });

    it('throws NotFoundException and writes nothing when the camera does not exist', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      (prisma as any).camera = { update: jest.fn() };

      await expect(service.softDeleteCamera(fakeRequest, 'nonexistent', admin)).rejects.toThrow(
        NotFoundException,
      );
      expect((prisma as any).camera.update).not.toHaveBeenCalled();
    });
  });
});
