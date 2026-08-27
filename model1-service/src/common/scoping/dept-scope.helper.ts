export type AppRole = 'admin' | 'field_officer' | 'dept_viewer' | 'auditor';

export interface AuthenticatedUser {
  userId: string;
  role: AppRole;
  departmentId: string | null;
}

/**
 * The single enforced choke point for dept_viewer row-level scoping
 * (PRD Section 6a point 4). Every service method that reads camera-derived
 * data for a role that can be dept_viewer MUST route its `where` clause
 * through this helper — never build department filtering ad hoc.
 *
 * For a dept_viewer, this ALWAYS overrides any departmentId already present
 * in baseWhere, so a caller can never widen their own scope by passing a
 * different departmentId in a query param.
 */
export function applyDeptScope<T extends Record<string, unknown>>(
  baseWhere: T,
  currentUser: AuthenticatedUser,
): T & { departmentId?: string } {
  if (currentUser.role !== 'dept_viewer') {
    return baseWhere;
  }

  return {
    ...baseWhere,
    departmentId: currentUser.departmentId ?? undefined,
  };
}
