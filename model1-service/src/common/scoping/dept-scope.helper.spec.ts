import { applyDeptScope, AuthenticatedUser } from './dept-scope.helper';

describe('applyDeptScope', () => {
  const deptViewer: AuthenticatedUser = {
    userId: 'user-1',
    role: 'dept_viewer',
    departmentId: 'dept-abc',
  };

  const admin: AuthenticatedUser = {
    userId: 'user-2',
    role: 'admin',
    departmentId: null,
  };

  it('injects departmentId into the where clause for a dept_viewer', () => {
    const result = applyDeptScope({ isActive: true }, deptViewer);
    expect(result).toEqual({ isActive: true, departmentId: 'dept-abc' });
  });

  it('does not modify the where clause for an admin', () => {
    const result = applyDeptScope({ isActive: true }, admin);
    expect(result).toEqual({ isActive: true });
  });

  it('does not modify the where clause for a field_officer', () => {
    const fieldOfficer: AuthenticatedUser = {
      userId: 'user-3',
      role: 'field_officer',
      departmentId: 'dept-xyz',
    };
    const result = applyDeptScope({ isActive: true }, fieldOfficer);
    expect(result).toEqual({ isActive: true });
  });

  it('does not modify the where clause for an auditor', () => {
    const auditor: AuthenticatedUser = {
      userId: 'user-4',
      role: 'auditor',
      departmentId: null,
    };
    const result = applyDeptScope({ isActive: true }, auditor);
    expect(result).toEqual({ isActive: true });
  });

  it('overrides any pre-existing departmentId in baseWhere for a dept_viewer, never letting the caller widen scope', () => {
    const result = applyDeptScope({ departmentId: 'attacker-supplied-dept' }, deptViewer);
    expect(result.departmentId).toBe('dept-abc');
  });
});
