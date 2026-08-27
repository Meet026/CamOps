import { IsUUID } from 'class-validator';

export class ScoreLookupPhotoDto {
  @IsUUID()
  cameraId!: string;
}
