import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyTotpDto {
  @IsString()
  @IsNotEmpty()
  mfaToken!: string;

  // Either a 6-digit TOTP code or a backup code (e.g. "ABCD-1234") — not
  // format-validated here, since both shapes are legitimate and
  // AuthService.verifyTotpLogin tries the TOTP path first, falling back
  // to backup codes.
  @IsString()
  @IsNotEmpty()
  code!: string;
}
