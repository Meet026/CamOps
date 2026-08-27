import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

const CAMERA_TYPES = ['analog', 'ip'] as const;

// Same field set as CreateCameraDto, except departmentCode (e.g. "HOME")
// instead of a raw departmentId UUID — field staff filling out a CSV know
// department codes, not UUIDs. The bulk-upload service resolves
// departmentCode -> departmentId via DepartmentLookupService before reusing
// CreateCameraDto/UpdateCameraDto internally.
export class BulkUploadRowDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  departmentCode!: string;

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
