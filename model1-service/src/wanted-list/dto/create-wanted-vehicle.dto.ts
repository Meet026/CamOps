import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWantedVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  personName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  crimeDetails!: string;
}
