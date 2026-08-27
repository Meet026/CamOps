import { apiClient } from './client'
import type { AppRole } from '@/types/api'

export interface UserSummary {
  userId: string
  email: string
  role: AppRole
  departmentId: string | null
}

export async function updateUserRole(userId: string, role: AppRole): Promise<void> {
  await apiClient.patch(`/users/${userId}/role`, { role })
}

export async function listUsers(query: { page?: number; limit?: number }): Promise<UserSummary[]> {
  const response = await apiClient.get<UserSummary[]>('/users', { params: query })
  return response.data
}
