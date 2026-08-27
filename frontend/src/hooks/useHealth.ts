import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as healthApi from '@/api/health'

export function useHealthCurrent(cameraId: string | undefined) {
  return useQuery({
    queryKey: ['health', 'current', cameraId],
    queryFn: () => healthApi.getHealthCurrent(cameraId as string),
    enabled: Boolean(cameraId),
  })
}

export function useHealthHistory(cameraId: string | undefined) {
  return useQuery({
    queryKey: ['health', 'history', cameraId],
    queryFn: () => healthApi.getHealthHistory(cameraId as string, { page: 1, limit: 50 }),
    enabled: Boolean(cameraId),
  })
}

export function useCheckNow(cameraId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (status?: 'online' | 'offline') => healthApi.checkNow(cameraId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health', 'current', cameraId] })
      queryClient.invalidateQueries({ queryKey: ['health', 'history', cameraId] })
      queryClient.invalidateQueries({ queryKey: ['cameras', 'detail', cameraId] })
    },
  })
}
