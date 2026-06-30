// Global guard for the `/internal/*` service zone.
//
// The /internal/* endpoints (sdk-tokens/verify, workspaces/:slug/branding,
// accounts, products-catalog) are NOT public. They are called only by
// trusted server-side services on the compose network (connect-tool, the
// admin web app). Historically they relied on "not being exposed at the
// public ingress" — but the Caddy `/api/poc/*` passthrough made them
// reachable from the internet, leaking workspace config + end-user account
// handles. This guard closes that at the application layer (defence in
// depth alongside the Caddy edge block), so every present AND future
// /internal route is protected by construction.
//
// Auth: callers MUST present `Authorization: Bearer <CONNECT_TOOL_SECRET>`
// (the shared internal-service credential). The check is constant-time.
//
// Registered as an APP_GUARD, so it sees every request — but it only
// enforces on paths beginning with `/internal/`. Everything else passes
// through untouched (the /v1 BearerApiKeyGuard and /admin/connect
// ConnectToolGuard still apply at their own controllers).
//
// If CONNECT_TOOL_SECRET is unset, the guard is permissive with a warning in
// non-production (a freshly-cloned dev box) — same dev-convenience model as
// ConnectToolGuard — so local stacks work without configuring a secret. In
// production a missing secret FAILS CLOSED (401): an unset credential must
// never silently expose the zone. Deploy note: CONNECT_TOOL_SECRET must be
// set in every production env (connect-tool already authenticates with it).

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const INTERNAL_PREFIX = '/internal/';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name);
  private warnedMissingSecret = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // Only govern the /internal/* zone; everything else is someone else's
    // concern. `req.path` is the express path without query string.
    const path = req.path ?? req.url ?? '';
    if (!path.startsWith(INTERNAL_PREFIX)) {
      return true;
    }

    const secret = this.config.get<string>('CONNECT_TOOL_SECRET');
    if (!secret) {
      const nodeEnv =
        this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
      if (nodeEnv === 'production') {
        // Fail closed in production: a missing secret must NEVER silently
        // expose the /internal/* zone (workspace config + end-user account
        // handles). Dev stays permissive for local convenience.
        throw new UnauthorizedException(
          'internal endpoint auth is not configured',
        );
      }
      // Warn once per process so logs aren't spammed.
      if (!this.warnedMissingSecret) {
        this.logger.warn(
          'CONNECT_TOOL_SECRET not set — /internal/* is unauthenticated (dev mode).',
        );
        this.warnedMissingSecret = true;
      }
      return true;
    }

    const auth = req.headers.authorization ?? '';
    const expected = `Bearer ${secret}`;
    if (auth.length === expected.length && constantTimeEquals(auth, expected)) {
      return true;
    }

    throw new UnauthorizedException(
      'internal endpoint requires the connect-tool service bearer',
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
