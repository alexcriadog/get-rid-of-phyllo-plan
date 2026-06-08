// Basic-auth guard for the Phyllo-compatible surface. Parses
// `Authorization: Basic base64(client_id:client_secret)`, verifies against
// PhylloCredentialsService, and attaches the resolved workspaceId to req.
// On failure throws a Phyllo-shaped 401 error envelope.

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { PhylloCredentialsService } from "./phyllo-credentials.service";
import { errorEnvelope } from "@modules/phyllo-compat";

export type RequestWithPhylloWorkspace = Request & {
  phylloWorkspaceId?: string;
};

@Injectable()
export class PhylloBasicAuthGuard implements CanActivate {
  constructor(private readonly creds: PhylloCredentialsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPhylloWorkspace>();
    const header = req.headers.authorization ?? "";
    const workspaceId = await this.resolve(header);
    if (!workspaceId) {
      throw new HttpException(
        errorEnvelope({
          type: "UNAUTHORIZED",
          code: "invalid_credentials",
          message: "Invalid client credentials",
          statusCode: 401,
          requestId: randomUUID(),
        }),
        401,
      );
    }
    req.phylloWorkspaceId = workspaceId;
    return true;
  }

  private async resolve(header: string): Promise<string | null> {
    if (!header.startsWith("Basic ")) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(
        header.slice("Basic ".length).trim(),
        "base64",
      ).toString("utf8");
    } catch {
      return null;
    }
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    const clientId = decoded.slice(0, sep);
    const clientSecret = decoded.slice(sep + 1);
    if (!clientId || !clientSecret) return null;
    return this.creds.verify(clientId, clientSecret);
  }
}
