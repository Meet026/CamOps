import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { attemptTcpPortCheck } from './tcp-port-check';

const CRON_JOB_NAME = 'health-check';
const DEFAULT_BATCH_SIZE = 20;

@Injectable()
export class HealthCheckCron implements OnModuleInit {
  private readonly logger = new Logger(HealthCheckCron.name);
  // In-memory overlap guard: if a previous tick hasn't finished, a new
  // tick logs a warning and returns immediately rather than starting a
  // second concurrent run. Batching + per-check timeouts keep a normal
  // run well under the interval at this project's expected scale, but
  // this is cheap insurance against that assumption changing later.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMinutes = this.config.get<number>('health.cronIntervalMinutes') ?? 5;
    const job = CronJob.from({
      cronTime: `0 */${intervalMinutes} * * * *`,
      onTick: () => {
        this.runHealthCheck().catch((error: Error) => {
          this.logger.error(`Health check cron run failed: ${error.message}`);
        });
      },
      start: true,
    });
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
  }

  async runHealthCheck(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Health check cron tick skipped — previous run still in progress');
      return;
    }
    this.isRunning = true;

    try {
      const cameras = await this.prisma.camera.findMany({
        where: { cameraType: 'ip', ipAddress: { not: null }, isActive: true },
        select: { cameraId: true, ipAddress: true, rtspPort: true },
      });

      const timeoutMs = this.config.get<number>('health.tcpTimeoutMs') ?? 2500;
      const batchSize = this.config.get<number>('health.batchSize') ?? DEFAULT_BATCH_SIZE;

      for (let i = 0; i < cameras.length; i += batchSize) {
        const batch = cameras.slice(i, i + batchSize);
        await Promise.all(batch.map((camera) => this.checkOneCamera(camera, timeoutMs)));
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async checkOneCamera(
    camera: { cameraId: string; ipAddress: string | null; rtspPort: number | null },
    timeoutMs: number,
  ): Promise<void> {
    if (!camera.ipAddress) return; // defensive — query already filters this

    const port = camera.rtspPort ?? 554;
    const result = await attemptTcpPortCheck(camera.ipAddress, port, timeoutMs);
    const status = result.online ? 'online' : 'offline';

    await this.prisma.cameraStatusHistory.create({
      data: { cameraId: camera.cameraId, status, responseTimeMs: result.responseTimeMs },
    });

    // Plain $executeRaw (not prisma.camera.update) here only because this
    // write must never touch location_geo and this keeps the write
    // minimal/explicit; a plain Prisma update would work identically since
    // current_status isn't a geography column — either is fine, this
    // matches the raw-SQL convention already used for other single-column
    // camera writes in this codebase (see ScoringService).
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE camera SET current_status = ${status}, updated_at = now() WHERE camera_id = ${camera.cameraId}::uuid`,
    );
  }
}
