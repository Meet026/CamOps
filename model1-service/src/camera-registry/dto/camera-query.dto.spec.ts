import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CameraQueryDto } from './camera-query.dto';

describe('CameraQueryDto', () => {
  it('defaults page/limit from PaginationDto and leaves filters undefined', async () => {
    const dto = plainToInstance(CameraQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(25);
    expect(dto.isActive).toBeUndefined();
  });

  it('accepts a full set of valid filters', async () => {
    const dto = plainToInstance(CameraQueryDto, {
      departmentId: '706b50a5-b637-4d7b-8a0a-d63ed164f598',
      cameraType: 'ip',
      integrationScore: 'easy',
      currentStatus: 'online',
      isActive: 'true',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(true);
  });

  it('parses isActive=false correctly, not as a truthy string', async () => {
    const dto = plainToInstance(CameraQueryDto, { isActive: 'false' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
  });

  it('rejects an invalid cameraType filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });

  it('rejects an invalid integrationScore filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { integrationScore: 'impossible' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'integrationScore')).toBe(true);
  });

  it('rejects an invalid currentStatus filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { currentStatus: 'sleeping' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'currentStatus')).toBe(true);
  });

  it('rejects a non-UUID departmentId filter', async () => {
    const dto = plainToInstance(CameraQueryDto, { departmentId: 'nope' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'departmentId')).toBe(true);
  });
});
