import { vehicleApiClient } from './vehicleClient'
import type { VehicleApiHealth, VehicleRouteResponse } from '@/types/vehicleApi'

export async function searchVehicleRoute(photo: File): Promise<VehicleRouteResponse> {
  const formData = new FormData()
  formData.append('photo', photo)
  const response = await vehicleApiClient.post<VehicleRouteResponse>('/vehicles/route', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function getVehicleApiHealth(): Promise<VehicleApiHealth> {
  const response = await vehicleApiClient.get<VehicleApiHealth>('/health')
  return response.data
}
