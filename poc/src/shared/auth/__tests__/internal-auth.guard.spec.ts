import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { InternalAuthGuard } from '../internal-auth.guard';

const SECRET = 'super-secret-internal-bearer';

function makeConfig(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

function makeConfigMap(map: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

function ctxFor(path: string, authHeader?: string): ExecutionContext {
  const req = { path, url: path, headers: authHeader ? { authorization: authHeader } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('InternalAuthGuard', () => {
  it('passes through non-/internal paths without a bearer', () => {
    const guard = new InternalAuthGuard(makeConfig(SECRET));
    expect(guard.canActivate(ctxFor('/v1/accounts/3/identity'))).toBe(true);
    expect(guard.canActivate(ctxFor('/admin/connect/seed'))).toBe(true);
  });

  it('allows /internal with the correct bearer', () => {
    const guard = new InternalAuthGuard(makeConfig(SECRET));
    expect(
      guard.canActivate(ctxFor('/internal/accounts', `Bearer ${SECRET}`)),
    ).toBe(true);
  });

  it('rejects /internal with a missing bearer', () => {
    const guard = new InternalAuthGuard(makeConfig(SECRET));
    expect(() => guard.canActivate(ctxFor('/internal/accounts'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects /internal with a wrong bearer', () => {
    const guard = new InternalAuthGuard(makeConfig(SECRET));
    expect(() =>
      guard.canActivate(ctxFor('/internal/sdk-tokens/verify', 'Bearer nope')),
    ).toThrow(UnauthorizedException);
  });

  it('is permissive on /internal when no secret is configured (dev mode)', () => {
    const guard = new InternalAuthGuard(makeConfig(undefined));
    expect(guard.canActivate(ctxFor('/internal/workspaces/demo/branding'))).toBe(
      true,
    );
  });

  it('FAILS CLOSED on /internal in production when no secret is configured', () => {
    const guard = new InternalAuthGuard(makeConfigMap({ NODE_ENV: 'production' }));
    expect(() => guard.canActivate(ctxFor('/internal/accounts'))).toThrow(
      UnauthorizedException,
    );
  });

  it('stays permissive on /internal in non-production when no secret is configured', () => {
    const guard = new InternalAuthGuard(makeConfigMap({ NODE_ENV: 'development' }));
    expect(guard.canActivate(ctxFor('/internal/accounts'))).toBe(true);
  });
});
