import { apiClient } from './client'
import type {
  BulkUploadJobStatus,
  CameraListQuery,
  CameraRecord,
  CreateCameraPayload,
  UpdateCameraPayload,
} from '@/types/api'

export async function listCameras(query: CameraListQuery): Promise<CameraRecord[]> {
  const response = await apiClient.get<CameraRecord[]>('/cameras', { params: query })
  return response.data
}

export async function getCamera(cameraId: string): Promise<CameraRecord> {
  const response = await apiClient.get<CameraRecord>(`/cameras/${cameraId}`)
  return response.data
}

export async function createCamera(payload: CreateCameraPayload): Promise<CameraRecord> {
  const response = await apiClient.post<CameraRecord>('/cameras', payload)
  return response.data
}

export async function updateCamera(
  cameraId: string,
  payload: UpdateCameraPayload,
): Promise<CameraRecord> {
  const response = await apiClient.patch<CameraRecord>(`/cameras/${cameraId}`, payload)
  return response.data
}

export async function deactivateCamera(cameraId: string): Promise<void> {
  await apiClient.delete(`/cameras/${cameraId}`)
}

export async function uploadCameraPhoto(cameraId: string, file: File): Promise<CameraRecord> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post<CameraRecord>(`/cameras/${cameraId}/photo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function exportCameras(query: CameraListQuery): Promise<Blob> {
  const response = await apiClient.get('/cameras/export', {
    params: query,
    responseType: 'blob',
  })
  return response.data
}

export async function startBulkUpload(file: File): Promise<{ jobId: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post<{ jobId: string }>('/cameras/bulk', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function getBulkUploadJobStatus(jobId: string): Promise<BulkUploadJobStatus> {
  const response = await apiClient.get<BulkUploadJobStatus>(`/cameras/bulk/${jobId}`)
  return response.data
}
