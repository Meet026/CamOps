import { CameraExportService } from './camera-export.service';
import { CameraRecord } from '../camera-registry.service';

describe('CameraExportService', () => {
  let service: CameraExportService;

  beforeEach(() => {
    service = new CameraExportService();
  });

  const sampleCamera: CameraRecord = {
    cameraId: 'cam-1',
    departmentId: 'dept-1',
    name: 'Camera A',
    addressText: null,
    cameraType: 'ip',
    brand: 'Hikvision',
    model: 'DS-2CD',
    onvifStatus: 'unknown',
    onvifSource: null,
    integrationScore: 'needs_verification',
    dataConfidence: 'self_reported',
    photoUrl: null,
    currentStatus: 'unknown',
    installedAt: null,
    isActive: true,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    longitude: 72.5714,
    latitude: 23.0225,
  };

  it('generates a CSV header row with the expected columns', () => {
    const csv = service.generateCsv([]);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toContain('cameraId');
    expect(headerLine).toContain('name');
    expect(headerLine).toContain('latitude');
    expect(headerLine).toContain('longitude');
    expect(headerLine).toContain('integrationScore');
  });

  it('generates one data row per camera with correct values', () => {
    const csv = service.generateCsv([sampleCamera]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Camera A');
    expect(lines[1]).toContain('Hikvision');
    expect(lines[1]).toContain('23.0225');
  });

  it('returns just the header row for an empty camera list', () => {
    const csv = service.generateCsv([]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});
