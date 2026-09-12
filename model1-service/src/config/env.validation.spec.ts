import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validConfig = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRY: '15m',
    REFRESH_TOKEN_SECRET: 'b'.repeat(32),
    REFRESH_TOKEN_EXPIRY: '7d',
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), // real 32-byte key
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    NODE_ENV: 'development',
  };

  it('returns a validated config object when all required vars are present and valid', () => {
    const result = validateEnv(validConfig);
    expect(result.DATABASE_URL).toBe(validConfig.DATABASE_URL);
    expect(result.PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when PORT is not a number', () => {
    expect(() =>
      validateEnv({ ...validConfig, PORT: 'not-a-number' }),
    ).toThrow();
  });

  it('throws when NODE_ENV is not one of the allowed values', () => {
    expect(() =>
      validateEnv({ ...validConfig, NODE_ENV: 'staging-typo' }),
    ).toThrow();
  });

  it('defaults NODE_ENV to development when not provided', () => {
    const { NODE_ENV, ...rest } = validConfig;
    const result = validateEnv(rest);
    expect(result.NODE_ENV).toBe('development');
  });

  it('throws when TOTP_ENCRYPTION_KEY is missing', () => {
    const { TOTP_ENCRYPTION_KEY, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow();
  });

  it('throws when TOTP_ENCRYPTION_KEY does not decode to exactly 32 bytes', () => {
    expect(() =>
      validateEnv({ ...validConfig, TOTP_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow();
  });
});
