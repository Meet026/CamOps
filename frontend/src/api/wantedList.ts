import { apiClient } from './client'
import type { CheckPlateResult } from '@/types/api'

export async function checkPlate(plate: string): Promise<CheckPlateResult> {
  const response = await apiClient.get<CheckPlateResult>('/wanted-list/check-plate', {
    params: { plate },
  })
  return response.data
}
