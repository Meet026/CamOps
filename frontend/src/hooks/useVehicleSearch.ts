import { useMutation } from '@tanstack/react-query'
import * as vehiclesApi from '@/api/vehicles'
import type { VehicleRouteSearchAnchor } from '@/api/vehicles'

export function useVehicleRouteSearch() {
  return useMutation({
    mutationFn: ({ photo, anchor }: { photo: File; anchor?: VehicleRouteSearchAnchor }) =>
      vehiclesApi.searchVehicleRoute(photo, anchor),
  })
}
