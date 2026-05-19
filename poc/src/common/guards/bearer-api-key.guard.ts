import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService, ResolvedApiKey } from '@modules/api-keys/api-keys.service';

/**
 * Bearer API key guard used by every `/v1/*` route.
 *
 * Expects `Authorization: Bearer cmlk_(live|test)_<token>`. On success
 * attaches a `workspace` object to `req` so handlers can scope queries:
 *
 *   const ws = (req as RequestWithWorkspace).workspace;
 *   prisma.account.findMany({ where: { workspaceId: ws.id } })
 *
 * Failures throw `UnauthorizedException` so the framework returns a clean
 * 401 with no detail leak.
 */
@Injectable()
export class BearerApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithWorkspace>();
    const auth = req.headers.authorization ?? '';

    if (!auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const rawKey = auth.slice('Bearer '.length).trim();
    const resolved = await this.apiKeys.verify(rawKey);
    req.workspace = resolved;
    return true;
  }
}

export type RequestWithWorkspace = Request & {
  workspace?: ResolvedApiKey;
};
