// InsightIQ-compatible data endpoints: profiles, social/contents (+bulk search),
// audience, social/comments. Mounted at /v1/* — Basic auth,
// workspace-scoped. Serves the dual-written canonical docs verbatim.

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
  type ApiAudience,
  type ApiComment,
  type ApiContent,
  type ApiListEnvelope,
  type ApiProfile,
} from "@modules/data-schema";
import {
  ApiBasicAuthGuard,
  type RequestWithApiWorkspace,
} from "./basic-auth.guard";
import { ApiAccountResolver } from "./account-resolver.service";
import { ApiReadService } from "./read.service";
import { badRequest, notFound, parseDate, parseOffsetLimit } from "./http";

@Controller("v1")
@UseGuards(ApiBasicAuthGuard)
export class DataController {
  constructor(
    private readonly resolver: ApiAccountResolver,
    private readonly read: ApiReadService,
  ) {}

  private ws(req: RequestWithApiWorkspace): string {
    return req.apiWorkspaceId as string;
  }

  private async requireAccountPk(
    req: RequestWithApiWorkspace,
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
    @Req() req: RequestWithApiWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<ApiListEnvelope<ApiProfile>> {
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
    @Req() req: RequestWithApiWorkspace,
    @Param("id") id: string,
  ): Promise<ApiProfile> {
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
    @Req() req: RequestWithApiWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("from_date") fromDate: string | undefined,
    @Query("to_date") toDate: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<ApiListEnvelope<ApiContent>> {
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
    @Req() req: RequestWithApiWorkspace,
    @Param("id") id: string,
  ): Promise<ApiContent> {
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
    @Req() req: RequestWithApiWorkspace,
    @Body() body: { ids?: unknown },
  ): Promise<ApiListEnvelope<ApiContent>> {
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
    @Req() req: RequestWithApiWorkspace,
    @Query("account_id") accountId: string | undefined,
  ): Promise<ApiAudience> {
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
    @Req() req: RequestWithApiWorkspace,
    @Query("account_id") accountId: string | undefined,
    @Query("content_id") contentId: string | undefined,
    @Query("offset") offsetRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
  ): Promise<ApiListEnvelope<ApiComment>> {
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
    req: RequestWithApiWorkspace,
    accountPk: string,
    code: string,
  ): Promise<void> {
    const owned = await this.resolver.accountsFor(this.ws(req));
    if (!owned.some((a) => a.id.toString() === accountPk)) {
      throw notFound(code, "Requested resource does not exist");
    }
  }
}
