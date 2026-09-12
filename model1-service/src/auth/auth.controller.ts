import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
  // logged in. AuthService.login returns the resulting userId so it can be
  // (a) stamped onto request.user, purely for the interceptor's benefit,
  // and (b) recorded as the audit entityId; it is deliberately stripped
  // back out of the object returned to the client, since the frontend's
  // LoginResult contract is just { accessToken, refreshToken }.
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
}
