import { IsIn, IsOptional } from 'class-validator';

export class WantedListQueryDto {
  @IsOptional()
  @IsIn(['active', 'resolved'])
  status?: 'active' | 'resolved';
}
