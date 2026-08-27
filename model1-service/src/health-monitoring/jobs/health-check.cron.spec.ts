import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckCron } from './health-check.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('./tcp-port-check', () => ({
  attemptTcpPortCheck: jest.fn(),
}));
import { attemptTcpPortCheck } from './tcp-port-check';

describe('HealthCheckCron', () => {
  let cron: HealthCheckCron;
  let prisma: {
    camera: { findMany: jest.Mock };
    cameraStatusHistory: { create: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let schedulerRegistry: { addCronJob: jest.Mock };
  let config: ConfigService;

  beforeEach(async () => {
    prisma = {
      camera: { findMany: jest.fn() },
      cameraStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    schedulerRegistry = { addCronJob: jest.fn() };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, number> = {
          'health.cronIntervalMinutes': 5,
          'health.tcpTimeoutMs': 2500,
          'health.batchSize': 20,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckCron,
        { provide: PrismaService, useValue: prisma },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    cron = module.get(HealthCheckCron);
    (attemptTcpPortCheck as jest.Mock).mockReset();
  });

  it('registers a cron job with SchedulerRegistry on module init', () => {
    cron.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('health-check', expect.anything());

    // CronJob.from({ start: true }) creates a real, live-scheduled system
    // timer — SchedulerRegistry.addCronJob is mocked here, so nothing else
    // ever calls .stop() on it, leaving a dangling handle that keeps the
    // process alive after the test suite finishes. Stop it explicitly.
    const [, job] = schedulerRegistry.addCronJob.mock.calls[0];
    job.stop();
  });

  it('queries only active IP cameras with a non-null ip_address', async () => {
    prisma.camera.findMany.mockResolvedValue([]);

    await cron.runHealthCheck();

    expect(prisma.camera.findMany).toHaveBeenCalledWith({
      where: { cameraType: 'ip', ipAddress: { not: null }, isActive: true },
      select: { cameraId: true, ipAddress: true, rtspPort: true },
    });
  });

  it('writes a history row and updates current_status for each checked camera', async () => {
    prisma.camera.findMany.mockResolvedValue([
      { cameraId: 'cam-1', ipAddress: '10.0.0.5', rtspPort: 554 },
    ]);
    (attemptTcpPortCheck as jest.Mock).mockResolvedValue({ online: true, responseTimeMs: 30 });

    await cron.runHealthCheck();

    expect(prisma.cameraStatusHistory.create).toHaveBeenCalledWith({
      data: { cameraId: 'cam-1', status: 'online', responseTimeMs: 30 },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('skips a run entirely (does not query cameras) if a previous run is still in progress', async () => {
    let resolveFirstRun: () => void = () => {};
    prisma.camera.findMany.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstRun = () => resolve([]); }),
    );

    const firstRun = cron.runHealthCheck();
    const secondRun = cron.runHealthCheck();

    expect(prisma.camera.findMany).toHaveBeenCalledTimes(1);

    resolveFirstRun();
    await Promise.all([firstRun, secondRun]);
  });
});
