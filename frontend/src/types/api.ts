// ============================================================================
// API types — mirror the real backend contracts exactly.
// Source: model1-service/src/**/*.ts (controllers, DTOs, service return types)
// Do not add fields here that the backend doesn't actually return — this
// file is a contract mirror, not a wishlist.
// ============================================================================

export type AppRole = 'admin' | 'field_officer' | 'dept_viewer' | 'auditor';

export interface AuthenticatedUser {
  userId: string;
  role: AppRole;
  departmentId: string | null;
}

// Login now branches on whether the account has 2FA enabled: either the
// normal token pair, or a short-lived mfaToken that must be exchanged via
// POST /auth/totp/verify for the real tokens.
export type LoginResponse =
  | { accessToken: string; refreshToken: string; mfaRequired?: false }
  | { mfaRequired: true; mfaToken: string };

export interface RefreshResponse {
  accessToken: string;
}

// ----------------------------------------------------------------------------
// TOTP two-factor authentication
// ----------------------------------------------------------------------------

export interface TotpStatus {
  enabled: boolean;
  enabledAt: string | null;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface TotpConfirmResponse {
  backupCodes: string[];
}

export interface TotpVerifyResponse {
  accessToken: string;
  refreshToken: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
}

// ----------------------------------------------------------------------------
// Camera Registry
// ----------------------------------------------------------------------------

export type CameraType = 'analog' | 'ip';
export type OnvifStatus = 'yes' | 'no' | 'unknown';
export type IntegrationScore = 'easy' | 'medium' | 'hard' | 'needs_verification';
export type OnvifSource = 'lookup_table' | 'ai_guess' | 'user_confirmed' | null;
export type DataConfidence = 'verified_in_person' | 'verified_api' | 'self_reported';
export type CurrentStatus = 'online' | 'offline' | 'unknown';

export interface CameraRecord {
  cameraId: string;
  departmentId: string;
  name: string;
  addressText: string | null;
  cameraType: CameraType;
  brand: string | null;
  model: string | null;
  onvifStatus: OnvifStatus;
  onvifSource: OnvifSource;
  integrationScore: IntegrationScore;
  dataConfidence: DataConfidence;
  photoUrl: string | null;
  currentStatus: CurrentStatus;
  installedAt: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  longitude: number;
  latitude: number;
  ipAddress: string | null;
  rtspPort: number | null;
  streamPath: string | null;
}

export interface CreateCameraPayload {
  name: string;
  departmentId: string;
  latitude: number;
  longitude: number;
  cameraType: CameraType;
  brand?: string;
  model?: string;
  addressText?: string;
  installedAt?: string;
}

// Network fields (ipAddress/rtspPort/streamPath) are edit-only — they power
// health-monitoring's TCP check but aren't meaningful to set at creation
// time, so they're deliberately absent from CreateCameraPayload.
export type UpdateCameraPayload = Partial<CreateCameraPayload> & {
  ipAddress?: string;
  rtspPort?: number;
  streamPath?: string;
};

export interface CameraListQuery {
  page?: number;
  limit?: number;
  departmentId?: string;
  cameraType?: CameraType;
  integrationScore?: IntegrationScore;
  currentStatus?: CurrentStatus;
  isActive?: boolean;
  search?: string;
}

export interface BulkUploadJobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  processedRows: number;
  succeededCount: number;
  failedCount: number;
  rowErrors: Array<{ row: number; error: string }> | null;
  createdAt: string;
  completedAt: string | null;
}

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

export interface ScoringResult {
  onvifStatus: OnvifStatus;
  integrationScore: IntegrationScore;
  onvifSource: OnvifSource;
  dataConfidence: DataConfidence;
}

export interface PhotoLookupResult {
  identified: boolean;
  brand?: string;
  model?: string;
  onvifStatus?: OnvifStatus;
  integrationScore?: IntegrationScore;
  onvifSource?: OnvifSource;
  dataConfidence?: DataConfidence;
}

export interface PendingVerification {
  verificationId: string;
  cameraId: string;
  cameraName: string;
  brand: string | null;
  model: string | null;
  aiSuggestedOnvif: string | null;
  aiConfidenceNote: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
}

export interface VerifyScoringResult {
  verificationId: string;
  status: 'confirmed' | 'rejected';
}

// ----------------------------------------------------------------------------
// Health Monitoring
// ----------------------------------------------------------------------------

export interface HealthCurrentStatus {
  currentStatus: CurrentStatus;
  ipAddress: string | null;
  rtspPort: number | null;
}

export interface HealthHistoryEntry {
  id: number;
  cameraId: string;
  status: 'online' | 'offline';
  checkedAt: string;
  responseTimeMs: number | null;
}

export interface AtRiskCamera {
  cameraId: string;
  name: string;
  departmentId: string;
  currentStatus: CurrentStatus;
  offlineCount: number;
}

export interface CheckNowResult {
  status: 'online' | 'offline';
  checkedAt: string;
  responseTimeMs: number | null;
}

// ----------------------------------------------------------------------------
// GIS
// ----------------------------------------------------------------------------

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface CameraPin {
  cameraId: string;
  name: string;
  latitude: number;
  longitude: number;
  departmentId: string;
  cameraType: CameraType;
  currentStatus: CurrentStatus;
  integrationScore: IntegrationScore;
}

export interface GapAnalysisResult {
  gridSize: number;
  gaps: MapBounds[];
}

export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

export interface HeatmapResult {
  beta: true;
  label: string;
  points: HeatmapPoint[];
}

// ----------------------------------------------------------------------------
// Wanted List (read-only — departments maintain these records elsewhere;
// this app only checks a plate number and surfaces a notification)
// ----------------------------------------------------------------------------

export interface WantedVehicle {
  wantedVehicleId: string;
  personName: string;
  plateNumber: string;
  crimeDetails: string;
  status: 'active' | 'resolved';
  departmentId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CheckPlateResult {
  matched: boolean;
  wantedVehicle: WantedVehicle | null;
}

export interface WantedListNotification {
  notificationId: string;
  wantedVehicleId: string;
  source: 'manual_search';
  matchedPlateNumber: string;
  isRead: boolean;
  createdAt: string;
  personName: string;
  plateNumber: string;
  crimeDetails: string;
}
