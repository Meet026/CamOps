import { apiClient } from './client'

export interface Department {
  departmentId: string
  name: string
  code: string
}

export async function listDepartments(): Promise<Department[]> {
  const response = await apiClient.get<Department[]>('/departments')
  return response.data
}
