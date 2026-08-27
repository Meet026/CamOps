import {
  IsDateString,
  IsIn,
  IsIP,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

export class UpdateCameraDto {
  @IsOptional()
  @IsString()
  name?: string;

  // A lone latitude or longitude is meaningless — there's no way to know
  // which axis to leave unchanged. If either is present, the other becomes
  // required, so a camera's location only ever moves as a complete pair.
  @ValidateIf((dto) => dto.longitude !== undefined)
  @IsLatitude()
  latitude?: number;

  @ValidateIf((dto) => dto.latitude !== undefined)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsIn(CAMERA_TYPES)
  cameraType?: (typeof CAMERA_TYPES)[number];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsDateString()
  installedAt?: string;

  // Populates the fields health-monitoring's TCP check depends on — edit-only,
  // never settable at creation time (see UpdateCameraDto vs CreateCameraDto).
  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  rtspPort?: number;

  @IsOptional()
  @IsString()
  streamPath?: string;
}
