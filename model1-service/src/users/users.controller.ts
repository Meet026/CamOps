import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles('admin')
  @Get()
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  // Reference example endpoint for before/after audit capture — see
  // UsersService.updateRole's doc comment. admin-only since changing
  // someone's role is a sensitive action.
  @Roles('admin')
  @Audit('update_role', 'app_user')
  @Patch(':id/role')
  async updateRole(@Req() request: Request, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(request, id, dto.role);
  }
}
