import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BulkUploadRowDto } from './bulk-upload-row.dto';

describe('BulkUploadRowDto', () => {
  const validPayload = {
    name: 'Main Gate Camera',
    departmentCode: 'HOME',
    latitude: 23.0225,
    longitude: 72.5714,
    cameraType: 'ip',
  };

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(BulkUploadRowDto, validPayload);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing departmentCode', async () => {
    const { departmentCode, ...rest } = validPayload;
    const dto = plainToInstance(BulkUploadRowDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentCode')).toBe(true);
  });

  it('rejects an out-of-range latitude', async () => {
    const dto = plainToInstance(BulkUploadRowDto, { ...validPayload, latitude: 999 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an invalid cameraType', async () => {
    const dto = plainToInstance(BulkUploadRowDto, { ...validPayload, cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const { name, ...rest } = validPayload;
    const dto = plainToInstance(BulkUploadRowDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
