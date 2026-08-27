export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRY ?? '15m',
  },
  refreshToken: {
    secret: process.env.REFRESH_TOKEN_SECRET,
    expiry: process.env.REFRESH_TOKEN_EXPIRY ?? '7d',
  },
  cors: {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  health: {
    cronIntervalMinutes: parseInt(process.env.HEALTH_CHECK_CRON_INTERVAL_MINUTES ?? '5', 10),
    atRiskOfflineThreshold: parseInt(process.env.HEALTH_AT_RISK_OFFLINE_THRESHOLD ?? '3', 10),
    atRiskWindowDays: parseInt(process.env.HEALTH_AT_RISK_WINDOW_DAYS ?? '14', 10),
    tcpTimeoutMs: parseInt(process.env.HEALTH_CHECK_TCP_TIMEOUT_MS ?? '2500', 10),
    batchSize: parseInt(process.env.HEALTH_CHECK_BATCH_SIZE ?? '20', 10),
  },
  gis: {
    gapAnalysisDefaultGridSize: parseInt(process.env.GIS_GAP_ANALYSIS_DEFAULT_GRID_SIZE ?? '10', 10),
  },
});
