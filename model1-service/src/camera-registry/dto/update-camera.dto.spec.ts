import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCameraDto } from './update-camera.dto';

describe('UpdateCameraDto', () => {
  it('accepts an empty payload (no fields changed)', async () => {
    const dto = plainToInstance(UpdateCameraDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts updating just the name', async () => {
    const dto = plainToInstance(UpdateCameraDto, { name: 'Renamed Camera' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts updating both latitude and longitude together', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 23.03, longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects latitude provided without longitude', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 23.03 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('rejects longitude provided without latitude', async () => {
    const dto = plainToInstance(UpdateCameraDto, { longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an out-of-range latitude even when longitude is present', async () => {
    const dto = plainToInstance(UpdateCameraDto, { latitude: 999, longitude: 72.58 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects an invalid cameraType', async () => {
    const dto = plainToInstance(UpdateCameraDto, { cameraType: 'drone' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'cameraType')).toBe(true);
  });
});
