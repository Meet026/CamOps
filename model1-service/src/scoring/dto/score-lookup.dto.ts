import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ScoreLookupDto {
  @IsUUID()
  cameraId!: string;

  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;
}
