import { apiClient } from './client'
import type { PendingVerification, PhotoLookupResult, ScoringResult, VerifyScoringResult } from '@/types/api'

export async function lookupScoring(
  cameraId: string,
  brand: string,
  model: string,
): Promise<ScoringResult> {
  const response = await apiClient.post<ScoringResult>('/scoring/lookup', {
    cameraId,
    brand,
    model,
  })
  return response.data
}

export async function lookupScoringByPhoto(cameraId: string): Promise<PhotoLookupResult> {
  const response = await apiClient.post<PhotoLookupResult>('/scoring/lookup/photo', { cameraId })
  return response.data
}

export async function listPendingVerifications(query: {
  page?: number
  limit?: number
}): Promise<PendingVerification[]> {
  const response = await apiClient.get<PendingVerification[]>('/scoring/pending-verification', {
    params: query,
  })
  return response.data
}

export async function verifyScoring(
  verificationId: string,
  decision: 'confirm' | 'reject',
  finalOnvifStatus?: 'yes' | 'no',
): Promise<VerifyScoringResult> {
  const response = await apiClient.post<VerifyScoringResult>(`/scoring/verify/${verificationId}`, {
    decision,
    finalOnvifStatus,
  })
  return response.data
}

export async function listKnownBrands(): Promise<string[]> {
  const response = await apiClient.get<string[]>('/scoring/vendor-lookup/brands')
  return response.data
}
