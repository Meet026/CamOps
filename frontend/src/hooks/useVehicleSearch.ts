import { useMutation } from '@tanstack/react-query'
import * as vehiclesApi from '@/api/vehicles'

export function useVehicleRouteSearch() {
  return useMutation({
    mutationFn: (photo: File) => vehiclesApi.searchVehicleRoute(photo),
  })
}
