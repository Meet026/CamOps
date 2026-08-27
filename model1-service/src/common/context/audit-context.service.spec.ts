import { Request } from 'express';
import { AuditContextService } from './audit-context.service';

describe('AuditContextService', () => {
  let service: AuditContextService;
  let request: Partial<Request>;

  beforeEach(() => {
    service = new AuditContextService();
    request = {};
  });

  it('returns undefined when no changes have been set on the request', () => {
    expect(service.getChanges(request as Request)).toBeUndefined();
  });

  it('returns the before/after values after setChanges is called on the request', () => {
    service.setChanges(request as Request, { integrationScore: 'easy' }, { integrationScore: 'medium' });

    expect(service.getChanges(request as Request)).toEqual({
      before: { integrationScore: 'easy' },
      after: { integrationScore: 'medium' },
    });
  });

  it('keeps changes isolated per request object — two different requests never see each other\'s data', () => {
    const requestA: Partial<Request> = {};
    const requestB: Partial<Request> = {};

    service.setChanges(requestA as Request, { role: 'field_officer' }, { role: 'admin' });
    service.setChanges(requestB as Request, { isActive: true }, { isActive: false });

    expect(service.getChanges(requestA as Request)).toEqual({
      before: { role: 'field_officer' },
      after: { role: 'admin' },
    });
    expect(service.getChanges(requestB as Request)).toEqual({
      before: { isActive: true },
      after: { isActive: false },
    });
  });
});
