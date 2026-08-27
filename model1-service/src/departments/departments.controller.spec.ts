import { Test, TestingModule } from '@nestjs/testing';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';

describe('DepartmentsController', () => {
  let controller: DepartmentsController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [{ provide: DepartmentsService, useValue: service }],
    }).compile();

    controller = module.get(DepartmentsController);
  });

  it('list delegates to DepartmentsService.list', async () => {
    const departments = [{ departmentId: 'dept-1', name: 'Home', code: 'HOME' }];
    service.list.mockResolvedValue(departments);

    const result = await controller.list();

    expect(service.list).toHaveBeenCalledWith();
    expect(result).toEqual(departments);
  });
});
