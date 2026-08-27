import { Module } from '@nestjs/common';
import { HealthMonitoringController } from './health.controller';
import { HealthMonitoringService } from './health.service';
import { HealthCheckCron } from './jobs/health-check.cron';
import { CameraRegistryModule } from '../camera-registry/camera-registry.module';

@Module({
  imports: [CameraRegistryModule],
  controllers: [HealthMonitoringController],
  providers: [HealthMonitoringService, HealthCheckCron],
  exports: [HealthMonitoringService],
})
export class HealthMonitoringModule {}
