import { apiClient } from './client'
import type { AuthenticatedUser, LoginResponse, RefreshResponse } from '@/types/api'

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', { email, password })
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
