import { apiClient } from './client'
import type {
  AuthenticatedUser,
  LoginResponse,
  RefreshResponse,
  TotpConfirmResponse,
  TotpSetupResponse,
  TotpStatus,
  TotpVerifyResponse,
} from '@/types/api'

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', { email, password })
  return response.data
}

// Public route — takes the short-lived mfaToken from login, not the access
// token, so it deliberately doesn't go through apiClient's Authorization
// header (that's the actual access token; mfaToken travels in the body).
export async function verifyTotp(mfaToken: string, code: string): Promise<TotpVerifyResponse> {
  const response = await apiClient.post<TotpVerifyResponse>('/auth/totp/verify', { mfaToken, code })
  return response.data
}

export async function getTotpStatus(): Promise<TotpStatus> {
  const response = await apiClient.get<TotpStatus>('/auth/totp/status')
  return response.data
}

export async function setupTotp(): Promise<TotpSetupResponse> {
  const response = await apiClient.post<TotpSetupResponse>('/auth/totp/setup')
  return response.data
}

export async function confirmTotp(code: string): Promise<TotpConfirmResponse> {
  const response = await apiClient.post<TotpConfirmResponse>('/auth/totp/confirm', { code })
  return response.data
}

export async function disableTotp(currentPassword: string): Promise<void> {
  await apiClient.post('/auth/totp/disable', { currentPassword })
}

export async function regenerateBackupCodes(currentPassword: string): Promise<TotpConfirmResponse> {
  const response = await apiClient.post<TotpConfirmResponse>('/auth/totp/backup-codes/regenerate', {
    currentPassword,
  })
  return response.data
}

export async function refresh(refreshToken: string): Promise<RefreshResponse> {
  const response = await apiClient.post<RefreshResponse>('/auth/refresh', { refreshToken })
  return response.data
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post('/auth/logout', { refreshToken })
}

export interface UserProfile extends AuthenticatedUser {
  email: string
}

export async function getMe(): Promise<UserProfile> {
  const response = await apiClient.get<UserProfile>('/auth/me')
  return response.data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword })
}
