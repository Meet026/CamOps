import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaginationDto } from './pagination.dto';

describe('PaginationDto', () => {
  it('defaults page to 1 and limit to 25 when not provided', async () => {
    const dto = plainToInstance(PaginationDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(25);
  });

  it('accepts a valid page and limit', async () => {
    const dto = plainToInstance(PaginationDto, { page: '2', limit: '50' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('rejects a limit greater than 100', async () => {
    const dto = plainToInstance(PaginationDto, { limit: '101' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('rejects a page less than 1', async () => {
    const dto = plainToInstance(PaginationDto, { page: '0' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('rejects a non-integer limit', async () => {
    const dto = plainToInstance(PaginationDto, { limit: '25.5' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
