import { useMutation } from '@tanstack/react-query'
import * as vehiclesApi from '@/api/vehicles'
import type { VehicleRouteSearchInput } from '@/api/vehicles'

export function useVehicleRouteSearch() {
  return useMutation({
    mutationFn: (input: VehicleRouteSearchInput) => vehiclesApi.searchVehicleRoute(input),
  })
}
