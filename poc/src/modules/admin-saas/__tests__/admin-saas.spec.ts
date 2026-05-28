import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ProductsSchema } from '../admin-saas.controller';
import { ConnectToolGuard } from '../../admin/connect-tool.guard';

// ─── Zod schema (D2): allowlist + identity requirement ─────────────────────

describe('ProductsSchema (admin /admin/workspaces/:slug/products body)', () => {
  it('accepts a well-formed config with identity in every platform', () => {
    const result = ProductsSchema.safeParse({
      facebook: ['identity', 'audience'],
      tiktok: ['identity'],
      youtube: ['identity', 'ads'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown platform keys (enum allowlist)', () => {
    const result = ProductsSchema.safeParse({
      hackerplatform: ['identity'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown product values (enum allowlist)', () => {
    const result = ProductsSchema.safeParse({
      tiktok: ['identity', 'rogue_product'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty product array for an enabled platform (min length 1)', () => {
    const result = ProductsSchema.safeParse({ tiktok: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an enabled platform missing identity', () => {
    const result = ProductsSchema.safeParse({
      tiktok: ['audience'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = JSON.stringify(result.error.issues);
      expect(msg).toMatch(/identity/i);
    }
  });

  it('accepts an empty object as the "clear restrictions" sentinel', () => {
    const result = ProductsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('defaults an undefined body to the empty/clear sentinel', () => {
    const result = ProductsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });
});

// ─── Guard (D1): bearer + loopback bypass ──────────────────────────────────

function mockExec(headers: Record<string, string>, remote = '8.8.8.8'): ExecutionContext {
  const req: Partial<Request> = {
    headers,
    ip: remote,
    socket: { remoteAddress: remote } as Request['socket'],
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ConnectToolGuard', () => {
  it('is permissive when CONNECT_TOOL_SECRET is unset (local-dev convenience)', () => {
    const cfg = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const guard = new ConnectToolGuard(cfg);
    expect(guard.canActivate(mockExec({}))).toBe(true);
  });

  it('bypasses external auth for loopback callers', () => {
    const cfg = { get: jest.fn().mockReturnValue('s3cret') } as unknown as ConfigService;
    const guard = new ConnectToolGuard(cfg);
    expect(guard.canActivate(mockExec({}, '127.0.0.1'))).toBe(true);
  });

  it('accepts a matching bearer token', () => {
    const cfg = { get: jest.fn().mockReturnValue('s3cret') } as unknown as ConfigService;
    const guard = new ConnectToolGuard(cfg);
    const ctx = mockExec({ authorization: 'Bearer s3cret' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when bearer is missing on a non-loopback caller', () => {
    const cfg = { get: jest.fn().mockReturnValue('s3cret') } as unknown as ConfigService;
    const guard = new ConnectToolGuard(cfg);
    expect(() => guard.canActivate(mockExec({}))).toThrow(UnauthorizedException);
  });

  it('rejects when bearer is wrong on a non-loopback caller', () => {
    const cfg = { get: jest.fn().mockReturnValue('s3cret') } as unknown as ConfigService;
    const guard = new ConnectToolGuard(cfg);
    const ctx = mockExec({ authorization: 'Bearer wrong-token' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
