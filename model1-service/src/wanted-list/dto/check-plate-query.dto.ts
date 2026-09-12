import { IsNotEmpty, IsString } from 'class-validator';

export class CheckPlateQueryDto {
  @IsString()
  @IsNotEmpty()
  plate!: string;
}
