import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const expiresIn = configService.get<string>('jwt.expiry');
        return {
          secret: configService.get<string>('jwt.secret'),
          // `jwt.expiry` is a runtime string from env config ('15m'), not
          // known at compile time, so it can't structurally match the
          // library's `StringValue` template-literal type — the cast is
          // safe because the underlying `ms`-based parser accepts any
          // valid duration string regardless of this narrower type.
          signOptions: { expiresIn: expiresIn as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService, JwtStrategy],
})
export class AuthModule {}
