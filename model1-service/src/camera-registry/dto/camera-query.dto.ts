import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const CAMERA_TYPES = ['analog', 'ip'] as const;
const INTEGRATION_SCORES = ['easy', 'medium', 'hard', 'needs_verification'] as const;
const CURRENT_STATUSES = ['online', 'offline', 'unknown'] as const;

export class CameraQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(CAMERA_TYPES)
  cameraType?: (typeof CAMERA_TYPES)[number];

  @IsOptional()
  @IsIn(INTEGRATION_SCORES)
  integrationScore?: (typeof INTEGRATION_SCORES)[number];

  @IsOptional()
  @IsIn(CURRENT_STATUSES)
  currentStatus?: (typeof CURRENT_STATUSES)[number];

  // No default — omitted means both active and inactive cameras are
  // returned. Explicit true/false narrows to exactly that subset.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  // Free-text search across name and address_text (BACKEND_GAPS.md #6) —
  // filters the whole dataset server-side, not just the currently-loaded page.
  @IsOptional()
  @IsString()
  search?: string;
}
