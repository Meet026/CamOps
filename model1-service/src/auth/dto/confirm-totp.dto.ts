import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmTotpDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}
