// Bearer-token guard for /admin/connect/seed and /admin/connect/discover.
//
// connect-tool (the transient OAuth helper at ../../connect-tool/) is the
// only legitimate caller of these routes in production. It MUST present
// `Authorization: Bearer ${CONNECT_TOOL_SECRET}`. Loopback callers
// (operator running curl on the host, smoke-tests, the POC's own admin
// UI when paste-token-fallback is used) are allowed unconditionally so
// nothing breaks during local development.
//
// CONNECT_TOOL_SECRET unset → guard is disabled with a warning. This
// keeps a freshly-cloned POC working without forcing operators to
// configure connect-tool first.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';

const LOOPBACK_PREFIXES = ['127.', '::1', '::ffff:127.'];

@Injectable()
export class ConnectToolGuard implements CanActivate {
  private readonly logger = new Logger(ConnectToolGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const secret = this.config.get<string>('CONNECT_TOOL_SECRET');

    // No secret configured → permissive for local-dev convenience.
    if (!secret) {
      this.logger.warn(
        'CONNECT_TOOL_SECRET not set — /admin/connect/* is unauthenticated.',
      );
      return true;
    }

    // Loopback bypass (operator on the host running curl). We key ONLY on
    // the real socket IP — NOT the Host header, which a client fully
    // controls (an attacker could send `Host: localhost:3000` through the
    // proxy to forge a bypass). req.ip is trustworthy here because the app
    // does not enable Express `trust proxy`, so X-Forwarded-For can't spoof
    // it — behind Caddy req.ip is the proxy's container IP (non-loopback),
    // which correctly forces the bearer check for all proxied traffic.
    const ip = (req.ip ?? req.socket?.remoteAddress ?? '').toLowerCase();
    if (LOOPBACK_PREFIXES.some((p) => ip.startsWith(p))) {
      return true;
    }

    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${secret}`;
    if (auth.length === expected.length && constantTimeEquals(auth, expected)) {
      return true;
    }

    throw new UnauthorizedException(
      'connect-tool bearer token missing or invalid',
    );
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
