import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: { updateRole: jest.Mock; list: jest.Mock };

  beforeEach(async () => {
    usersService = { updateRole: jest.fn(), list: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('updateRole delegates to UsersService.updateRole with the request, id, and new role', async () => {
    const updatedUser = { userId: 'user-1', email: 'x@y.com', role: 'admin' };
    const fakeRequest = {} as any;
    usersService.updateRole.mockResolvedValue(updatedUser);

    const result = await controller.updateRole(fakeRequest, 'user-1', { role: 'admin' });

    expect(usersService.updateRole).toHaveBeenCalledWith(fakeRequest, 'user-1', 'admin');
    expect(result).toEqual(updatedUser);
  });

  it('list delegates to UsersService.list with the query, admin-only', async () => {
    const query = { page: 1, limit: 25 };
    const users = [{ userId: 'user-1', email: 'admin@sentinel.local', role: 'admin', departmentId: null }];
    usersService.list.mockResolvedValue(users);

    const result = await controller.list(query as any);

    expect(usersService.list).toHaveBeenCalledWith(query);
    expect(result).toEqual(users);
  });
});
