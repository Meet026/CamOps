import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRY: string = '15m';

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_SECRET!: string;

  @IsString()
  @IsOptional()
  REFRESH_TOKEN_EXPIRY: string = '7d';

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  OPENAI_MODEL?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_CLOUD_NAME?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_API_KEY?: string;

  @IsString()
  @IsOptional()
  CLOUDINARY_API_SECRET?: string;

  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_CRON_INTERVAL_MINUTES: number = 5;

  @IsNumber()
  @IsOptional()
  HEALTH_AT_RISK_OFFLINE_THRESHOLD: number = 3;

  @IsNumber()
  @IsOptional()
  HEALTH_AT_RISK_WINDOW_DAYS: number = 14;

  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_TCP_TIMEOUT_MS: number = 2500;

  @IsNumber()
  @IsOptional()
  HEALTH_CHECK_BATCH_SIZE: number = 20;

  @IsNumber()
  @IsOptional()
  GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE: number = 10;

  @IsString()
  @IsNotEmpty()
  CORS_ALLOWED_ORIGINS!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsIn([NodeEnv.Development, NodeEnv.Production, NodeEnv.Test])
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
