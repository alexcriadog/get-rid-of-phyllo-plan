// Mongo reads for the InsightIQ-compatible surface. The canonical docs are stored
// already in InsightIQ wire shape (dual-write), so this returns the embedded
// `doc` verbatim plus list paging. Tenancy is enforced by the controllers via
// ApiAccountResolver (account_pk → workspace).

import { Injectable } from "@nestjs/common";
import { MongoService } from "@shared/database/mongo.service";
import type {
  ApiProfile,
  ApiContent,
  ApiAudience,
  ApiComment,
} from "@modules/data-schema";

interface Wrapper<T> {
  id: string;
  account_pk: string;
  doc: T;
}

@Injectable()
export class ApiReadService {
  constructor(private readonly mongo: MongoService) {}

  async profileByAccountPk(accountPk: string): Promise<ApiProfile | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiProfile>>("profiles")
      .findOne({ account_pk: accountPk });
    return row?.doc ?? null;
  }

  async profileById(
    id: string,
  ): Promise<{ doc: ApiProfile; accountPk: string } | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiProfile>>("profiles")
      .findOne({ id });
    return row ? { doc: row.doc, accountPk: row.account_pk } : null;
  }

  async audienceByAccountPk(accountPk: string): Promise<ApiAudience | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiAudience>>("audience")
      .findOne({ account_pk: accountPk });
    return row?.doc ?? null;
  }

  async contents(
    accountPk: string,
    opts: { offset: number; limit: number; fromDate?: Date; toDate?: Date },
  ): Promise<ApiContent[]> {
    const filter: Record<string, unknown> = { account_pk: accountPk };
    if (opts.fromDate || opts.toDate) {
      const range: Record<string, Date> = {};
      if (opts.fromDate) range.$gte = opts.fromDate;
      if (opts.toDate) range.$lte = opts.toDate;
      filter.published_at = range;
    }
    const rows = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .find(filter)
      .sort({ published_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return rows.map((r) => r.doc);
  }

  async contentById(
    id: string,
  ): Promise<{ doc: ApiContent; accountPk: string } | null> {
    const row = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .findOne({ id });
    return row ? { doc: row.doc, accountPk: row.account_pk } : null;
  }

  async contentsByIds(
    ids: string[],
  ): Promise<Array<{ doc: ApiContent; accountPk: string }>> {
    const rows = await this.mongo
      .getCollection<Wrapper<ApiContent>>("contents")
      .find({ id: { $in: ids } })
      .toArray();
    return rows.map((r) => ({ doc: r.doc, accountPk: r.account_pk }));
  }

  async comments(
    accountPk: string,
    contentExternalId: string,
    opts: { offset: number; limit: number },
  ): Promise<ApiComment[]> {
    const rows = await this.mongo
      .getCollection<Wrapper<ApiComment>>("comments")
      .find({ account_pk: accountPk, content_external_id: contentExternalId })
      .sort({ updated_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return rows.map((r) => r.doc);
  }
}
