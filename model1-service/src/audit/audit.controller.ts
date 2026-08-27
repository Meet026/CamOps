import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('audit-log')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Roles('admin', 'auditor')
  @Get()
  async list(@Query() query: AuditLogQueryDto) {
    return this.auditService.list(query);
  }
}
