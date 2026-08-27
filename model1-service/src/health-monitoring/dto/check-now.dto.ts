import { IsIn, IsOptional } from 'class-validator';

const STATUSES = ['online', 'offline'] as const;

export class CheckNowDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
