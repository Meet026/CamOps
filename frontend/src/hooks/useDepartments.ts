import { useQuery } from '@tanstack/react-query'
import * as departmentsApi from '@/api/departments'

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.listDepartments(),
    staleTime: 5 * 60 * 1000, // departments essentially never change mid-session
  })
}
