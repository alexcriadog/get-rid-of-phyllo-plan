import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { SdkTokenClaims, SdkTokensService } from './sdk-tokens.service';

const VerifyBodySchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();

/**
 * Internal endpoint used by connect-ui (the hosted OAuth popup app) to
 * verify SDK tokens it receives in the popup URL. Lives on /internal so
 * it's never exposed at the public ingress. Relies on docker-compose
 * network isolation — same trust model as
 * /internal/workspaces/:slug/branding.
 *
 * Returns the decoded claims; throws 401 on any tamper/expiry/sig fail.
 */
@Controller('internal/sdk-tokens')
export class InternalSdkTokensController {
  constructor(private readonly sdkTokens: SdkTokensService) {}

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown): Promise<{ claims: SdkTokenClaims }> {
    const parsed = VerifyBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid verify payload',
        issues: parsed.error.issues,
      });
    }
    const claims = await this.sdkTokens.verify(parsed.data.token);
    return { claims };
  }
}
