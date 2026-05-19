import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  SdkTokenClaims,
  SdkTokensService,
} from '@modules/sdk-tokens/sdk-tokens.service';

/**
 * SDK JWT guard used by hosted-UI-facing routes (`/internal/connect/*`,
 * the seed callback, etc).
 *
 * The token can arrive in either:
 *   - Authorization: Bearer <jwt>
 *   - ?token=<jwt> query param (so the popup can land on a route via
 *     redirect without exposing the token in a header).
 *
 * On success attaches `req.sdkToken = SdkTokenClaims`. Handlers should
 * trust `req.sdkToken.ws` as the tenant scope and `req.sdkToken.sub` as
 * the end-user id.
 */
@Injectable()
export class SdkJwtGuard implements CanActivate {
  constructor(private readonly sdkTokens: SdkTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSdkToken>();
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing SDK token');
    }
    const claims = await this.sdkTokens.verify(token);
    req.sdkToken = claims;
    return true;
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const query = req.query as Record<string, unknown>;
  const queryToken = query['token'];
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }
  return null;
}

export type RequestWithSdkToken = Request & {
  sdkToken?: SdkTokenClaims;
};
