import { apiClient } from './client'
import type { CheckPlateResult, CreatedWantedVehicle, WantedVehicle } from '@/types/api'

export async function checkPlate(plate: string): Promise<CheckPlateResult> {
  const response = await apiClient.get<CheckPlateResult>('/wanted-list/check-plate', {
    params: { plate },
  })
  return response.data
}

export async function listWanted(status: 'active' | 'resolved'): Promise<WantedVehicle[]> {
  const response = await apiClient.get<WantedVehicle[]>('/wanted-list', { params: { status } })
  return response.data
}

export interface CreateWantedVehicleInput {
  plateNumber: string
  personName: string
  crimeDetails: string
}

export async function createWanted(input: CreateWantedVehicleInput): Promise<CreatedWantedVehicle> {
  const response = await apiClient.post<CreatedWantedVehicle>('/wanted-list', input)
  return response.data
}

export async function resolveWanted(wantedVehicleId: string): Promise<WantedVehicle> {
  const response = await apiClient.post<WantedVehicle>(`/wanted-list/${wantedVehicleId}/resolve`)
  return response.data
}
