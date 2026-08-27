import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

export class CreateCameraDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsUUID()
  departmentId!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsIn(CAMERA_TYPES)
  cameraType!: (typeof CAMERA_TYPES)[number];

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
}
