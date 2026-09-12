import { apiClient } from './client'
import type { WantedListNotification } from '@/types/api'

export async function listNotifications(params?: {
  unreadOnly?: boolean
  limit?: number
}): Promise<WantedListNotification[]> {
  const response = await apiClient.get<WantedListNotification[]>('/notifications', { params })
  return response.data
}

export async function getUnreadCount(): Promise<number> {
  const response = await apiClient.get<{ count: number }>('/notifications/unread-count')
  return response.data.count
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiClient.post(`/notifications/${notificationId}/read`)
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post('/notifications/read-all')
}
