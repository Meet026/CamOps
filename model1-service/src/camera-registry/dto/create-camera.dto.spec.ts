import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCameraDto } from './create-camera.dto';

describe('CreateCameraDto', () => {
  const validPayload = {
    name: 'Main Gate Camera',
    departmentId: '706b50a5-b637-4d7b-8a0a-d63ed164f598',
    latitude: 23.0225,
    longitude: 72.5714,
    cameraType: 'ip',
  };

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(CreateCameraDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a full payload including optional fields', async () => {
    const dto = plainToInstance(CreateCameraDto, {
      ...validPayload,
      brand: 'Hikvision',
      model: 'DS-2CD2143G0-I',
      addressText: 'Near Main Gate, Sector 5',
      installedAt: '2026-01-15',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const { name, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a missing departmentId', async () => {
    const { departmentId, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });

  it('rejects a non-UUID departmentId', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, departmentId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });

  it('rejects an out-of-range latitude', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, latitude: 200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an out-of-range longitude', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, longitude: -200 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('rejects a cameraType that is not analog or ip', async () => {
    const dto = plainToInstance(CreateCameraDto, { ...validPayload, cameraType: 'wireless' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects a missing cameraType', async () => {
    const { cameraType, ...rest } = validPayload;
    const dto = plainToInstance(CreateCameraDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });
});
