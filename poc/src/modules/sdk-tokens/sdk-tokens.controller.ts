import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';
import { SdkTokensService } from './sdk-tokens.service';

const MintBodySchema = z
  .object({
    user_id: z.string().min(1).max(256),
    ttl: z.number().int().min(60).max(1800).optional(),
    allowed_platforms: z.array(z.string().min(1)).max(6).optional(),
  })
  .strict();

@Controller('v1')
@UseGuards(BearerApiKeyGuard)
export class SdkTokensController {
  constructor(private readonly sdkTokens: SdkTokensService) {}

  @Post('sdk-tokens')
  @HttpCode(200)
  async mint(
    @Req() req: RequestWithWorkspace,
    @Body() body: unknown,
  ): Promise<{ sdk_token: string; expires_at: string }> {
    const ws = req.workspace?.workspaceId;
    if (!ws) {
      throw new Error('Workspace context missing on authenticated request');
    }
    const parsed = MintBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid sdk-token payload',
        issues: parsed.error.issues,
      });
    }
    const minted = await this.sdkTokens.mint({
      workspaceId: ws,
      endUserId: parsed.data.user_id,
      ttlSeconds: parsed.data.ttl,
      allowedPlatforms: parsed.data.allowed_platforms,
    });
    return {
      sdk_token: minted.token,
      expires_at: minted.expiresAt.toISOString(),
    };
  }
}
