import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MapBoundsQueryDto } from './map-bounds-query.dto';

export class GapAnalysisQueryDto extends MapBoundsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  gridSize?: number;
}
