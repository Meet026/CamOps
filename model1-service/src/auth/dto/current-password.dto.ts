import { IsNotEmpty, IsString } from 'class-validator';

// Shared by the two endpoints that require re-confirming the current
// password before acting (disable 2FA, regenerate backup codes) — see
// docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §6-§7
// for why an already-authenticated session alone isn't enough for either.
export class CurrentPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
