import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();

    controller = module.get(AuditController);
  });

  it('list delegates to AuditService.list with the query', async () => {
    const query = { page: 1, limit: 25 };
    const rows = [{ auditId: 'audit-1' }];
    service.list.mockResolvedValue(rows);

    const result = await controller.list(query as any);

    expect(service.list).toHaveBeenCalledWith(query);
    expect(result).toEqual(rows);
  });
});
