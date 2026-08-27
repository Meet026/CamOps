import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token.service';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
}

export interface ProfileResult {
  userId: string;
  email: string;
  role: string;
  departmentId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  private signAccessToken(user: { userId: string; role: string; departmentId: string | null }) {
    return this.jwtService.sign({
      sub: user.userId,
      role: user.role,
      departmentId: user.departmentId,
    });
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.signAccessToken(user);
    const { token: refreshToken } = await this.refreshTokenService.issue(user.userId);

    return { accessToken, refreshToken };
  }

  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    const validated = await this.refreshTokenService.validate(rawRefreshToken);
    if (!validated) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(validated.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(user);
    return { accessToken };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(rawRefreshToken);
  }

  async getProfile(userId: string): Promise<ProfileResult> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordHash(userId, newHash);

    // Force re-authentication everywhere else — standard practice after a
    // password change, so a compromised old password can't keep a stale
    // session alive. The caller's own current access token remains valid
    // until its normal 15-minute expiry; their next refresh attempt will
    // correctly fail and prompt a fresh login with the new password.
    await this.refreshTokenService.revokeAllForUser(userId);
  }
}
