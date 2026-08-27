import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';

export class MapBoundsQueryDto {
  @Type(() => Number)
  @IsLatitude()
  minLat!: number;

  @Type(() => Number)
  @IsLongitude()
  minLng!: number;

  @Type(() => Number)
  @IsLatitude()
  maxLat!: number;

  @Type(() => Number)
  @IsLongitude()
  maxLng!: number;
}
