import { JwtService } from '@nestjs/jwt';
import { TotpChallengeJwtService } from './totp-challenge-jwt.service';

describe('TotpChallengeJwtService', () => {
  let service: TotpChallengeJwtService;

  beforeEach(() => {
    // A real JwtService signing with a fixed secret — not mocked — so
    // sign/verify are tested against each other honestly, the same way
    // the existing JwtStrategy is exercised in this codebase.
    const jwtService = new JwtService({ secret: 'test-jwt-secret' });
    service = new TotpChallengeJwtService(jwtService);
  });

  it('signs a token that verify() accepts and returns the userId from', () => {
    const token = service.sign('user-1');
    const result = service.verify(token);
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('rejects a token that is not a totp_challenge token (wrong purpose claim)', () => {
    // Simulate a real access token, signed with the SAME secret but a
    // different purpose — proves this service checks the claim, not just
    // the signature.
    const jwtService = new JwtService({ secret: 'test-jwt-secret' });
    const foreignToken = jwtService.sign({ sub: 'user-1', purpose: 'something_else' });
    expect(() => service.verify(foreignToken)).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const otherJwtService = new JwtService({ secret: 'a-different-secret' });
    const otherService = new TotpChallengeJwtService(otherJwtService);
    const token = otherService.sign('user-1');

    expect(() => service.verify(token)).toThrow();
  });

  it('rejects a garbage string without throwing an unhandled error type', () => {
    expect(() => service.verify('not-a-real-jwt')).toThrow();
  });
});
