import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { ConfirmTotpDto } from './dto/confirm-totp.dto';
import { CurrentPasswordDto } from './dto/current-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditContextService } from '../common/context/audit-context.service';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditContext: AuditContextService,
  ) {}

  // @Public() means the JwtAuthGuard never runs here, so unlike every other
  // audited route, there is no request.user for AuditLogInterceptor to read
  // an actor from — without the stamp below, every login row's userId
  // column would stay null forever, even though we know exactly who just
  // logged in. AuthService.login separately returns the resulting userId
  // so it can be (a) stamped onto request.user, purely for the
  // interceptor's benefit, and (b) recorded as the audit entityId; it is
  // deliberately stripped back out of the object returned to the client,
  // since the frontend's response contract never includes it.
  //
  // When 2FA is enabled, AuthService.login returns an MfaChallengeResult
  // instead of real tokens — same stripping/stamping applies, just a
  // different result shape (see docs/superpowers/specs/2026-09-12-totp-two-factor-auth-design.md §5).
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Audit('login', 'app_user')
  @Post('login')
  async login(@Req() request: Request, @Body() dto: LoginDto) {
    const { userId, ...result } = await this.authService.login(dto.email, dto.password);
    (request as Request & { user?: { userId: string } }).user = { userId };
    this.auditContext.setChanges(request, {}, {}, userId);
    return result;
  }

  // Completes the MFA-challenge flow started by login() above when 2FA is
  // enabled. Public (no bearer token exists yet at this point) but rate
  // limited the same as login itself — this is just as much a credential
  // check as a password, and should be defended against brute-forcing the
  // same way.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Audit('login', 'app_user')
  @Post('totp/verify')
  async verifyTotp(@Req() request: Request, @Body() dto: VerifyTotpDto) {
    const { userId, ...result } = await this.authService.verifyTotpLogin(dto.mfaToken, dto.code);
    (request as Request & { user?: { userId: string } }).user = { userId };
    this.auditContext.setChanges(request, {}, {}, userId);
    return result;
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Audit('logout', 'app_user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Body() dto: RefreshTokenDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.authService.logout(dto.refreshToken);
    this.auditContext.setChanges(request, {}, {}, currentUser.userId);
  }

  // No @Public() — must require authentication, unlike login/refresh.
  @Get('me')
  async me(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.getProfile(currentUser.userId);
  }

  // No @Public() — must require authentication.
  @Audit('change_password', 'app_user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('change-password')
  async changePassword(
    @Req() request: Request,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(currentUser.userId, dto.currentPassword, dto.newPassword);
    this.auditContext.setChanges(request, {}, {}, currentUser.userId);
  }

  // Starts (or restarts) 2FA enrollment. Not audited: nothing is enabled
  // yet at this point, just a pending secret written — the actual
  // security-relevant event is totpConfirm below.
  @Get('totp/status')
  async totpStatus(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.getTotpStatus(currentUser.userId);
  }

  @Post('totp/setup')
  async totpSetup(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.setupTotp(currentUser.userId);
  }

  @Audit('enable_totp', 'app_user')
  @Post('totp/confirm')
  async totpConfirm(
    @Req() request: Request,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: ConfirmTotpDto,
  ) {
    const result = await this.authService.confirmTotp(currentUser.userId, dto.code);
    this.auditContext.setChanges(request, {}, {}, currentUser.userId);
    return result;
  }

  @Audit('disable_totp', 'app_user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('totp/disable')
  async totpDisable(
    @Req() request: Request,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CurrentPasswordDto,
  ) {
    await this.authService.disableTotp(currentUser.userId, dto.currentPassword);
    this.auditContext.setChanges(request, {}, {}, currentUser.userId);
  }

  @Audit('regenerate_totp_backup_codes', 'app_user')
  @Post('totp/backup-codes/regenerate')
  async totpRegenerateBackupCodes(
    @Req() request: Request,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CurrentPasswordDto,
  ) {
    const result = await this.authService.regenerateBackupCodes(currentUser.userId, dto.currentPassword);
    this.auditContext.setChanges(request, {}, {}, currentUser.userId);
    return result;
  }
}
