import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { AccountsService, Platform, SeedAccountInput } from './accounts.service';

const SeedAccountBodySchema = z
  .object({
    platform: z.enum(['instagram', 'facebook']),
    access_token: z.string().min(10),
    canonical_user_id: z.string().min(1),
    handle: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

type SeedAccountBody = z.infer<typeof SeedAccountBodySchema>;

@Controller()
export class AccountsController {
  private readonly logger = new Logger(AccountsController.name);

  constructor(private readonly accounts: AccountsService) {}

  @Post('admin/seed-account')
  @HttpCode(201)
  async seedAccount(@Body() body: unknown): Promise<unknown> {
    const parsed = SeedAccountBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid seed-account payload',
        issues: parsed.error.issues,
      });
    }

    const input = this.toSeedInput(parsed.data);
    return this.accounts.seedAccount(input);
  }

  @Get('v1/accounts')
  async listAccounts(): Promise<unknown> {
    return this.accounts.listAccounts();
  }

  @Get('v1/accounts/:id')
  async getAccount(@Param('id') rawId: string): Promise<unknown> {
    const id = this.parseBigInt(rawId);
    return this.accounts.getAccount(id);
  }

  private toSeedInput(body: SeedAccountBody): SeedAccountInput {
    return {
      platform: body.platform as Platform,
      accessToken: body.access_token,
      canonicalUserId: body.canonical_user_id,
      handle: body.handle,
      metadata: body.metadata,
    };
  }

  private parseBigInt(raw: string): bigint {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(`Invalid account id: ${raw}`);
    }
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException(`Invalid account id: ${raw}`);
    }
  }
}
