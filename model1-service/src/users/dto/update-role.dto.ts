import { IsIn } from 'class-validator';

const ALLOWED_ROLES = ['admin', 'field_officer', 'dept_viewer', 'auditor'] as const;

export class UpdateRoleDto {
  @IsIn(ALLOWED_ROLES)
  role!: (typeof ALLOWED_ROLES)[number];
}
