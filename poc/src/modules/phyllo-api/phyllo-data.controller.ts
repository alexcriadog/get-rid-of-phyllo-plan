// Phyllo-compatible data endpoints: profiles, social/contents (+bulk search),
// audience, social/comments. Mounted at /phyllo/v1/* — Basic auth,
// workspace-scoped. Serves the dual-written phyllo_* docs verbatim.

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  listEnvelope,
  type PhylloAudience,
  type PhylloComment,
  type PhylloContent,
  type PhylloListEnvelope,
  type PhylloProfile,
} from "@modules/phyllo-compat";
import {
  PhylloBasicAuthGuard,
  type RequestWithPhylloWorkspace,
} from "./basic-auth.guard";
import { PhylloAccountResolver } from "./phyllo-account-resolver.service";
import { PhylloReadService } from "./phyllo-read.service";
import {
  badRequest,
  notFound,
  parseDate,
  parseOffsetLimit,
} from "./phyllo-http";

@Controller("phyllo/v1")
@UseGuards(PhylloBasicAuthGuard)
export class PhylloDataController {
  constructor(
    private readonly resolver: PhylloAccountResolver,
    private readonly read: PhylloReadService,
  ) {}

  private ws(req: RequestWithPhylloWorkspace): string {
    return req.phylloWorkspaceId as string;
  }

  private async requireAccountPk(
    req: RequestWithPhylloWorkspace,
    accountUuid: string,
  ): Promise<string> {
    const acc = await this.resolver.byAccountUuid(this.ws(req), accountUuid);
    if (!acc)
      throw notFound(
        "incorrect_account_id",
        "Requested account id does not exist",
      );
    return acc.id.toString();
  }

  // ── Profiles (Identity) ──
  @Get("profiles")
  async listProfiles(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<PhylloListEnvelope<PhylloProfile>> {
    if (!accountId)
      throw badRequest("missing_account_id", "account_id is required");
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const accountPk = await this.requireAccountPk(req, accountId);
    const profile = await this.read.profileByAccountPk(accountPk);
    const data = profile ? [profile] : [];
    return listEnvelope(data, { offset, limit });
  }

  @Get("profiles/:id")
  async getProfile(
    @Req() req: RequestWithPhylloWorkspace,
    @Param("id") id: string,
  ): Promise<PhylloProfile> {
    const found = await this.read.profileById(id);
    if (!found)
      throw notFound(
        "incorrect_profile_id",
        "Requested profile id does not exist",
      );
    await this.assertOwned(req, found.accountPk, "incorrect_profile_id");
    return found.doc;
  }

  // ── Contents (Engagement) ──
  @Get("social/contents")
  async listContents(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("from_date") fromDate: string | undefined,
    @Query("to_date") toDate: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<PhylloListEnvelope<PhylloContent>> {
    if (!accountId)
      throw badRequest("missing_account_id", "account_id is required");
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const accountPk = await this.requireAccountPk(req, accountId);
    const data = await this.read.contents(accountPk, {
      offset,
      limit,
      fromDate: parseDate(fromDate),
      toDate: parseDate(toDate),
    });
    return listEnvelope(data, {
      offset,
      limit,
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
    });
  }

  @Get("social/contents/:id")
  async getContent(
    @Req() req: RequestWithPhylloWorkspace,
    @Param("id") id: string,
  ): Promise<PhylloContent> {
    const found = await this.read.contentById(id);
    if (!found)
      throw notFound(
        "incorrect_content_id",
        "Requested content id does not exist",
      );
    await this.assertOwned(req, found.accountPk, "incorrect_content_id");
    return found.doc;
  }

  @Post("social/contents/search")
  async searchContents(
    @Req() req: RequestWithPhylloWorkspace,
    @Body() body: { ids?: unknown },
  ): Promise<PhylloListEnvelope<PhylloContent>> {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0)
      throw badRequest("missing_ids", "ids must be a non-empty array");
    if (ids.length > 100)
      throw badRequest("too_many_ids", "ids is limited to 100 per request");
    const ownedPks = new Set(
      (await this.resolver.accountsFor(this.ws(req))).map((a) =>
        a.id.toString(),
      ),
    );
    const found = await this.read.contentsByIds(ids);
    const data = found
      .filter((f) => ownedPks.has(f.accountPk))
      .map((f) => f.doc);
    return listEnvelope(data, { offset: 0, limit: data.length });
  }

  // ── Audience ──
  @Get("audience")
  async getAudience(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("account_id") accountId: string | undefined,
  ): Promise<PhylloAudience> {
    if (!accountId)
      throw badRequest("missing_account_id", "account_id is required");
    const accountPk = await this.requireAccountPk(req, accountId);
    const audience = await this.read.audienceByAccountPk(accountPk);
    if (!audience)
      throw notFound("audience_not_found", "No audience data for this account");
    return audience;
  }

  // ── Comments ──
  @Get("social/comments")
  async listComments(
    @Req() req: RequestWithPhylloWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("content_id") contentId: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<PhylloListEnvelope<PhylloComment>> {
    if (!accountId)
      throw badRequest("missing_account_id", "account_id is required");
    if (!contentId)
      throw badRequest("missing_content_id", "content_id is required");
    const { offset, limit } = parseOffsetLimit(offsetRaw, limitRaw);
    const accountPk = await this.requireAccountPk(req, accountId);
    // content_id is OUR content UUID — resolve to the platform external id.
    const content = await this.read.contentById(contentId);
    if (!content || content.accountPk !== accountPk) {
      throw notFound(
        "incorrect_content_id",
        "Requested content id does not exist",
      );
    }
    const externalId = content.doc.external_id;
    const data = await this.read.comments(accountPk, externalId, {
      offset,
      limit,
    });
    return listEnvelope(data, { offset, limit });
  }

  private async assertOwned(
    req: RequestWithPhylloWorkspace,
    accountPk: string,
    code: string,
  ): Promise<void> {
    const owned = await this.resolver.accountsFor(this.ws(req));
    if (!owned.some((a) => a.id.toString() === accountPk)) {
      throw notFound(code, "Requested resource does not exist");
    }
  }
}
