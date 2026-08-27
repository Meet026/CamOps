import { apiClient } from './client'
import type { AtRiskCamera, CheckNowResult, HealthCurrentStatus, HealthHistoryEntry } from '@/types/api'

export async function getHealthHistory(
  cameraId: string,
  query: { page?: number; limit?: number },
): Promise<HealthHistoryEntry[]> {
  const response = await apiClient.get<HealthHistoryEntry[]>(`/health/${cameraId}/history`, {
    params: query,
  })
  return response.data
}

export async function getHealthCurrent(cameraId: string): Promise<HealthCurrentStatus> {
  const response = await apiClient.get<HealthCurrentStatus>(`/health/${cameraId}/current`)
  return response.data
}

export async function getAtRiskCameras(): Promise<AtRiskCamera[]> {
  const response = await apiClient.get<AtRiskCamera[]>('/health/at-risk')
  return response.data
}

export async function checkNow(
  cameraId: string,
  status?: 'online' | 'offline',
): Promise<CheckNowResult> {
  const response = await apiClient.post<CheckNowResult>(`/health/${cameraId}/check-now`, {
    status,
  })
  return response.data
}
