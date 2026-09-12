import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { CameraRegistryController } from './camera-registry.controller';
import { CameraRegistryService } from './camera-registry.service';
import { BulkUploadService } from './bulk-upload/bulk-upload.service';
import { CameraExportService } from './export/camera-export.service';
import { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

describe('CameraRegistryController', () => {
  let controller: CameraRegistryController;
  let service: Record<string, jest.Mock>;
  let bulkUploadService: Record<string, jest.Mock>;
  let cameraExportService: Record<string, jest.Mock>;

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    role: 'admin',
    departmentId: null,
  };

  beforeEach(async () => {
    service = {
      createCamera: jest.fn(),
      listCameras: jest.fn(),
      getCameraById: jest.fn(),
      updateCamera: jest.fn(),
      softDeleteCamera: jest.fn(),
      listCamerasUnpaginated: jest.fn(),
      updateCameraPhoto: jest.fn(),
    };
    bulkUploadService = { createJob: jest.fn(), getJobStatus: jest.fn() };
    cameraExportService = { generateCsv: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CameraRegistryController],
      providers: [
        { provide: CameraRegistryService, useValue: service },
        { provide: BulkUploadService, useValue: bulkUploadService },
        { provide: CameraExportService, useValue: cameraExportService },
      ],
    }).compile();

    controller = module.get(CameraRegistryController);
  });

  it('create delegates to CameraRegistryService.createCamera with the dto and current user id', async () => {
    const dto = {
      name: 'Main Gate Camera',
      departmentId: 'dept-1',
      latitude: 23.0225,
      longitude: 72.5714,
      cameraType: 'ip' as const,
    };
    const createdCamera = { cameraId: 'cam-1', ...dto };
    service.createCamera.mockResolvedValue(createdCamera);
    const fakeRequest = {} as any;

    const result = await controller.create(fakeRequest, dto, currentUser);

    expect(service.createCamera).toHaveBeenCalledWith(fakeRequest, dto, 'user-1');
    expect(result).toEqual(createdCamera);
  });

  it('list delegates to CameraRegistryService.listCameras with the query and current user', async () => {
    const query = { page: 1, limit: 25 } as any;
    const cameras = [{ cameraId: 'cam-1' }];
    service.listCameras.mockResolvedValue(cameras);

    const result = await controller.list(query, currentUser);

    expect(service.listCameras).toHaveBeenCalledWith(query, currentUser);
    expect(result).toEqual(cameras);
  });

  it('getOne delegates to CameraRegistryService.getCameraById with the id and current user', async () => {
    const camera = { cameraId: 'cam-1' };
    service.getCameraById.mockResolvedValue(camera);

    const result = await controller.getOne('cam-1', currentUser);

    expect(service.getCameraById).toHaveBeenCalledWith('cam-1', currentUser);
    expect(result).toEqual(camera);
  });

  it('update delegates to CameraRegistryService.updateCamera with the request, id, dto, and current user', async () => {
    const fakeRequest = {} as Request;
    const dto = { name: 'New Name' };
    const updatedCamera = { cameraId: 'cam-1', name: 'New Name' };
    service.updateCamera.mockResolvedValue(updatedCamera);

    const result = await controller.update(fakeRequest, 'cam-1', dto, currentUser);

    expect(service.updateCamera).toHaveBeenCalledWith(fakeRequest, 'cam-1', dto, currentUser);
    expect(result).toEqual(updatedCamera);
  });

  it('remove delegates to CameraRegistryService.softDeleteCamera with the request, id, and current user', async () => {
    const fakeRequest = {} as Request;
    service.softDeleteCamera.mockResolvedValue(undefined);

    await controller.remove(fakeRequest, 'cam-1', currentUser);

    expect(service.softDeleteCamera).toHaveBeenCalledWith(fakeRequest, 'cam-1', currentUser);
  });

  it('uploadBulk delegates to BulkUploadService.createJob with the file buffer and current user id', async () => {
    const fakeFile = { buffer: Buffer.from('csv content') } as Express.Multer.File;
    bulkUploadService.createJob.mockResolvedValue({ jobId: 'job-1' });

    const result = await controller.uploadBulk(fakeFile, currentUser);

    expect(bulkUploadService.createJob).toHaveBeenCalledWith(fakeFile.buffer, 'user-1');
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('getBulkJobStatus delegates to BulkUploadService.getJobStatus with the jobId', async () => {
    const jobStatus = { jobId: 'job-1', status: 'completed' };
    bulkUploadService.getJobStatus = jest.fn().mockResolvedValue(jobStatus);

    const result = await controller.getBulkJobStatus('job-1');

    expect(bulkUploadService.getJobStatus).toHaveBeenCalledWith('job-1');
    expect(result).toEqual(jobStatus);
  });

  it('exportCsv writes CSV content to the response with correct headers', async () => {
    const cameras = [{ cameraId: 'cam-1', name: 'Camera A' }];
    service.listCamerasUnpaginated.mockResolvedValue(cameras);
    cameraExportService.generateCsv.mockReturnValue('cameraId,name\ncam-1,Camera A\n');
    const mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.exportCsv({} as any, currentUser, mockResponse as any);

    expect(service.listCamerasUnpaginated).toHaveBeenCalled();
    expect(cameraExportService.generateCsv).toHaveBeenCalledWith(cameras);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="cameras-export-'),
    );
    expect(mockResponse.send).toHaveBeenCalledWith('cameraId,name\ncam-1,Camera A\n');
  });

  it('uploadPhoto delegates to CameraRegistryService.updateCameraPhoto with the request, id, file buffer, and current user', async () => {
    const fakeRequest = {} as any;
    const fakeFile = { buffer: Buffer.from('fake image') } as Express.Multer.File;
    const updatedCamera = { cameraId: 'cam-1', photoUrl: 'https://res.cloudinary.com/test/cam-1.jpg' };
    service.updateCameraPhoto.mockResolvedValue(updatedCamera);

    const result = await controller.uploadPhoto(fakeRequest, 'cam-1', fakeFile, currentUser);

    expect(service.updateCameraPhoto).toHaveBeenCalledWith(fakeRequest, 'cam-1', fakeFile.buffer, currentUser);
    expect(result).toEqual(updatedCamera);
  });
});
