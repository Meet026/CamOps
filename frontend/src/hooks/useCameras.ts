import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as camerasApi from '@/api/cameras'
import type { CameraListQuery, CreateCameraPayload, UpdateCameraPayload } from '@/types/api'

export const cameraKeys = {
  all: ['cameras'] as const,
  list: (query: CameraListQuery) => ['cameras', 'list', query] as const,
  detail: (id: string) => ['cameras', 'detail', id] as const,
  bulkJob: (jobId: string) => ['cameras', 'bulk-job', jobId] as const,
}

export function useCameraList(query: CameraListQuery) {
  return useQuery({
    queryKey: cameraKeys.list(query),
    queryFn: () => camerasApi.listCameras(query),
  })
}

export function useCamera(cameraId: string | undefined) {
  return useQuery({
    queryKey: cameraKeys.detail(cameraId ?? ''),
    queryFn: () => camerasApi.getCamera(cameraId as string),
    enabled: Boolean(cameraId),
  })
}

export function useCreateCamera() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCameraPayload) => camerasApi.createCamera(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cameraKeys.all })
    },
  })
}

export function useUpdateCamera(cameraId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateCameraPayload) => camerasApi.updateCamera(cameraId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cameraKeys.all })
    },
  })
}

export function useDeactivateCamera() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cameraId: string) => camerasApi.deactivateCamera(cameraId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cameraKeys.all })
    },
  })
}

export function useUploadCameraPhoto(cameraId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => camerasApi.uploadCameraPhoto(cameraId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cameraKeys.detail(cameraId) })
    },
  })
}
