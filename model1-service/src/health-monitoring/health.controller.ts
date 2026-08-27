import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HealthMonitoringService } from './health.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { CheckNowDto } from './dto/check-now.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/scoping/dept-scope.helper';

@Controller('health')
export class HealthMonitoringController {
  constructor(private readonly healthService: HealthMonitoringService) {}

  // Declared before the :cameraId-prefixed routes below, matching the
  // project convention of literal path segments winning over parameterized
  // ones (see camera-registry.controller.ts's bulk/:jobId and export routes).
  @Roles('admin', 'field_officer')
  @Get('at-risk')
  async getAtRisk() {
    return this.healthService.getAtRisk();
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':cameraId/history')
  async getHistory(
    @Param('cameraId') cameraId: string,
    @Query() query: HistoryQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.getHistory(cameraId, query, currentUser);
  }

  @Roles('admin', 'field_officer', 'dept_viewer', 'auditor')
  @Get(':cameraId/current')
  async getCurrent(
    @Param('cameraId') cameraId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.getCurrent(cameraId, currentUser);
  }

  @Roles('admin', 'field_officer')
  @Audit('manual_health_check', 'camera')
  @Post(':cameraId/check-now')
  async checkNow(
    @Param('cameraId') cameraId: string,
    @Body() dto: CheckNowDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.healthService.checkNow(cameraId, dto.status, currentUser);
  }
}
